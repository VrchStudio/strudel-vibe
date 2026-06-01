//
//  NativeMIDIPlugin.swift
//  Strudel VibeLive iOS
//
//  CoreMIDI <-> Web MIDI bridge. Exposes the surface that
//  packages/iosbridge/web-midi-polyfill.iife.js expects, so the existing
//  WebMidi.js / @strudel/midi stack runs unchanged on iOS.
//
//  Add this file (and NativeMIDIPlugin.m) to the App target after `cap add ios`.
//  See docs/ios-setup.md.
//
import Foundation
import Capacitor
import CoreMIDI
import WebKit
#if canImport(UIKit)
import UIKit
#endif
import CoreAudioKit

@objc(NativeMIDIPlugin)
public class NativeMIDIPlugin: CAPPlugin {

    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var outputPort = MIDIPortRef()

    // uniqueID (Int32) -> endpoint, rebuilt on every setup change.
    private var sources: [Int32: MIDIEndpointRef] = [:]
    private var destinations: [Int32: MIDIEndpointRef] = [:]
    private var midiStarted = false

    // MARK: - Lifecycle

    public override func load() {
        // Inject the Web MIDI polyfill so navigator.requestMIDIAccess() exists
        // before Strudel ever touches MIDI. Kept here (not in the web bundle)
        // so the branch stays a pure wrapper.
        injectWebMIDIPolyfill()
    }

    private func injectWebMIDIPolyfill() {
        guard let url = Bundle.main.url(forResource: "web-midi-polyfill", withExtension: "js"),
              let js = try? String(contentsOf: url, encoding: .utf8) else {
            CAPLog.print("[NativeMIDI] web-midi-polyfill.js not found in bundle")
            return
        }
        guard let userContentController = bridge?.webView?.configuration.userContentController else {
            CAPLog.print("[NativeMIDI] no userContentController; cannot inject Web MIDI polyfill")
            return
        }
        // Must run at document-start so navigator.requestMIDIAccess exists before
        // the web app's MIDI code runs. evaluateJavaScript() during load() would
        // execute against the pre-navigation document and be wiped by the page load.
        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        userContentController.addUserScript(script)
    }

    // MARK: - CoreMIDI setup

    private func startMIDIIfNeeded() -> OSStatus {
        if midiStarted { return noErr }

        var status = MIDIClientCreateWithBlock("StrudelVibeLive" as CFString, &client) { [weak self] notification in
            // Any setup change (device added/removed) -> refresh + notify JS.
            let messageID = notification.pointee.messageID
            if messageID == .msgSetupChanged || messageID == .msgObjectAdded || messageID == .msgObjectRemoved {
                DispatchQueue.main.async { self?.refreshAndNotify() }
            }
        }
        guard status == noErr else { return status }

        status = MIDIInputPortCreateWithBlock(client, "StrudelInput" as CFString, &inputPort) { [weak self] packetList, srcConnRefCon in
            self?.handlePackets(packetList, srcConnRefCon: srcConnRefCon)
        }
        guard status == noErr else { return status }

        status = MIDIOutputPortCreate(client, "StrudelOutput" as CFString, &outputPort)
        guard status == noErr else { return status }

        midiStarted = true
        return noErr
    }

    /// Rebuild the endpoint maps and (re)connect all sources to our input port.
    private func rescanEndpoints() {
        // Disconnect old sources before rebuilding.
        for (_, src) in sources {
            MIDIPortDisconnectSource(inputPort, src)
        }
        sources.removeAll()
        destinations.removeAll()

        let srcCount = MIDIGetNumberOfSources()
        for i in 0..<srcCount {
            let src = MIDIGetSource(i)
            let uid = uniqueID(of: src)
            sources[uid] = src
            // Carry the uniqueID to the read block via the refCon's BIT PATTERN
            // (by value), not via a pointer to a local — CoreMIDI stores the
            // refCon as an opaque token and never dereferences it, so passing the
            // address of a stack variable would dangle and yield garbage ids.
            let refCon = UnsafeMutableRawPointer(bitPattern: Int(uid))
            MIDIPortConnectSource(inputPort, src, refCon)
        }

        let dstCount = MIDIGetNumberOfDestinations()
        for i in 0..<dstCount {
            let dst = MIDIGetDestination(i)
            destinations[uniqueID(of: dst)] = dst
        }
    }

    private func refreshAndNotify() {
        if startMIDIIfNeeded() == noErr {
            rescanEndpoints()
        }
        notifyListeners("statechange", data: ["ports": portList()])
    }

    // MARK: - Incoming MIDI

    private func handlePackets(_ packetList: UnsafePointer<MIDIPacketList>, srcConnRefCon: UnsafeMutableRawPointer?) {
        // The refCon IS the source uniqueID, carried by value in the pointer's
        // bit pattern (see rescanEndpoints). Recover it without dereferencing.
        let sourceId = Int32(truncatingIfNeeded: Int(bitPattern: srcConnRefCon))

        for packet in packetList.unsafeSequence() {
            let length = Int(packet.pointee.length)
            if length <= 0 { continue }
            var raw = [UInt8](); raw.reserveCapacity(length)
            withUnsafeBytes(of: packet.pointee.data) { buf in
                for i in 0..<length { raw.append(buf[i]) }
            }
            let timeStamp = Double(packet.pointee.timeStamp)
            // A single CoreMIDI packet can contain multiple MIDI messages (the
            // device may coalesce, e.g. a bulk CC dump). The Web MIDI API delivers
            // ONE message per event, so split before forwarding — otherwise
            // WebMidi.js parses only the first message and drops the rest.
            for message in Self.splitMIDIMessages(raw) {
                DispatchQueue.main.async { [weak self] in
                    self?.notifyListeners("midimessage", data: [
                        "id": String(sourceId),
                        "data": message,
                        "timeStamp": timeStamp,
                    ])
                }
            }
        }
    }

    /// Split a raw CoreMIDI byte run into individual MIDI messages.
    /// Handles channel voice/mode messages, System Common, System Realtime
    /// (which may interleave inside other messages), SysEx, and running status.
    static func splitMIDIMessages(_ bytes: [UInt8]) -> [[Int]] {
        var messages: [[Int]] = []
        var i = 0
        var runningStatus: UInt8 = 0
        let n = bytes.count

        // Number of data bytes for a channel voice/mode status (0x80–0xE0).
        func dataBytes(for status: UInt8) -> Int {
            switch status & 0xF0 {
            case 0xC0, 0xD0: return 1 // Program Change, Channel Pressure
            default: return 2 // Note off/on, Poly AT, CC, Pitch Bend
            }
        }

        while i < n {
            let byte = bytes[i]

            // System Realtime (0xF8–0xFF): single byte, may appear anywhere.
            if byte >= 0xF8 {
                messages.append([Int(byte)])
                i += 1
                continue
            }

            if byte == 0xF0 {
                // SysEx: consume through the next 0xF7 (or end of buffer).
                var msg: [Int] = []
                while i < n {
                    let b = bytes[i]
                    if b >= 0xF8 { // realtime interleaved inside SysEx: emit separately
                        messages.append([Int(b)])
                        i += 1
                        continue
                    }
                    msg.append(Int(b))
                    i += 1
                    if b == 0xF7 { break }
                }
                messages.append(msg)
                runningStatus = 0
                continue
            }

            if byte & 0x80 != 0 {
                // A status byte.
                if byte >= 0xF1 && byte <= 0xF7 {
                    // System Common: 0xF1/0xF3 have 1 data byte, 0xF2 has 2, others 0.
                    let dataCount = (byte == 0xF2) ? 2 : ((byte == 0xF1 || byte == 0xF3) ? 1 : 0)
                    var msg: [Int] = [Int(byte)]
                    i += 1
                    var c = 0
                    while c < dataCount && i < n && bytes[i] & 0x80 == 0 {
                        msg.append(Int(bytes[i])); i += 1; c += 1
                    }
                    messages.append(msg)
                    runningStatus = 0
                    continue
                }
                // Channel voice/mode status.
                runningStatus = byte
                let need = dataBytes(for: byte)
                var msg: [Int] = [Int(byte)]
                i += 1
                var c = 0
                while c < need && i < n && bytes[i] & 0x80 == 0 {
                    msg.append(Int(bytes[i])); i += 1; c += 1
                }
                messages.append(msg)
                continue
            }

            // Data byte with no preceding status -> running status.
            if runningStatus != 0 {
                let need = dataBytes(for: runningStatus)
                var msg: [Int] = [Int(runningStatus)]
                var c = 0
                while c < need && i < n && bytes[i] & 0x80 == 0 {
                    msg.append(Int(bytes[i])); i += 1; c += 1
                }
                messages.append(msg)
                continue
            }

            // Stray data byte with no running status — skip it.
            i += 1
        }

        return messages
    }

    // MARK: - Capacitor methods

    @objc func requestAccess(_ call: CAPPluginCall) {
        let status = startMIDIIfNeeded()
        guard status == noErr else {
            call.reject("CoreMIDI init failed (\(status))")
            return
        }
        rescanEndpoints()
        call.resolve(["ports": portList()])
    }

    @objc func listPorts(_ call: CAPPluginCall) {
        rescanEndpoints()
        call.resolve(["ports": portList()])
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let idStr = call.getString("id"), let uid = Int32(idStr) else {
            call.reject("missing/invalid port id")
            return
        }
        guard let dest = destinations[uid] else {
            call.reject("destination not found: \(idStr)")
            return
        }
        // JS numbers arrive as NSNumber through the WKWebView bridge; map each to a
        // MIDI byte. (A blanket `as? [Int]` can fail wholesale and silently send nothing.)
        let data: [UInt8] = (call.getArray("data") ?? []).compactMap { ($0 as? NSNumber)?.uint8Value }
        guard !data.isEmpty else {
            call.resolve()
            return
        }

        // TODO(scheduling): honour call.getDouble("timestamp") (a performance.now
        // ms value) by converting to MIDITimeStamp. For now we send immediately
        // (timestamp 0). Strudel already schedules close to real time in JS.
        var packetList = MIDIPacketList()
        let packet = MIDIPacketListInit(&packetList)
        let bytesToSend = data
        _ = bytesToSend.withUnsafeBufferPointer { buf in
            MIDIPacketListAdd(&packetList, 1024, packet, 0, buf.count, buf.baseAddress!)
        }
        let status = MIDISend(outputPort, dest, &packetList)
        if status == noErr {
            call.resolve()
        } else {
            call.reject("MIDISend failed (\(status))")
        }
    }

    @objc func openPort(_ call: CAPPluginCall) {
        // Sources are connected globally on rescan; nothing per-port to do.
        call.resolve()
    }

    @objc func closePort(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func showBluetoothCentral(_ call: CAPPluginCall) {
        #if canImport(UIKit)
        DispatchQueue.main.async {
            let vc = CABTMIDICentralViewController()
            let nav = UINavigationController(rootViewController: vc)
            vc.navigationItem.rightBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .done, target: self, action: #selector(self.dismissBluetooth))
            self.bridge?.viewController?.present(nav, animated: true) {
                call.resolve()
            }
        }
        #else
        call.reject("Bluetooth MIDI unavailable on this platform")
        #endif
    }

    @objc private func dismissBluetooth() {
        bridge?.viewController?.presentedViewController?.dismiss(animated: true)
    }

    // MARK: - Helpers

    private func portList() -> [[String: Any]] {
        var list: [[String: Any]] = []
        for (uid, ep) in sources {
            list.append(portInfo(uid: uid, endpoint: ep, type: "input"))
        }
        for (uid, ep) in destinations {
            list.append(portInfo(uid: uid, endpoint: ep, type: "output"))
        }
        return list
    }

    private func portInfo(uid: Int32, endpoint: MIDIEndpointRef, type: String) -> [String: Any] {
        return [
            "id": String(uid),
            "name": stringProperty(endpoint, kMIDIPropertyDisplayName) ?? stringProperty(endpoint, kMIDIPropertyName) ?? "MIDI \(type)",
            "manufacturer": stringProperty(endpoint, kMIDIPropertyManufacturer) ?? "",
            "version": "",
            "type": type,
            "state": "connected",
        ]
    }

    private func uniqueID(of obj: MIDIObjectRef) -> Int32 {
        var uid: Int32 = 0
        MIDIObjectGetIntegerProperty(obj, kMIDIPropertyUniqueID, &uid)
        return uid
    }

    private func stringProperty(_ obj: MIDIObjectRef, _ property: CFString) -> String? {
        var value: Unmanaged<CFString>?
        let status = MIDIObjectGetStringProperty(obj, property, &value)
        guard status == noErr, let cf = value?.takeRetainedValue() else { return nil }
        return cf as String
    }
}
