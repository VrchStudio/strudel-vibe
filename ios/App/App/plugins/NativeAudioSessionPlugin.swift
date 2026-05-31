//
//  NativeAudioSessionPlugin.swift
//  Strudel VibeLive iOS
//
//  Configures AVAudioSession for low-latency music playback in the WKWebView
//  and forwards interruption events to JS so the AudioContext can be resumed.
//
//  Add this file (and NativeAudioSessionPlugin.m) to the App target after
//  `cap add ios`. See docs/ios-setup.md.
//
import Foundation
import Capacitor
import AVFoundation

@objc(NativeAudioSessionPlugin)
public class NativeAudioSessionPlugin: CAPPlugin {

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil)
    }

    @objc func configure(_ call: CAPPluginCall) {
        let categoryStr = call.getString("category") ?? "playback"
        let mixWithOthers = call.getBool("mixWithOthers") ?? true
        let preferredBuffer = call.getDouble("preferredBufferDuration") ?? 0.005

        let session = AVAudioSession.sharedInstance()
        let category: AVAudioSession.Category = (categoryStr == "playAndRecord") ? .playAndRecord : .playback
        var options: AVAudioSession.CategoryOptions = []
        if mixWithOthers { options.insert(.mixWithOthers) }
        if category == .playAndRecord { options.insert(.defaultToSpeaker) }

        do {
            try session.setCategory(category, mode: .default, options: options)
            try session.setPreferredIOBufferDuration(preferredBuffer)
            try session.setActive(true)
            call.resolve()
        } catch {
            call.reject("AVAudioSession configure failed: \(error.localizedDescription)")
        }
    }

    @objc func activate(_ call: CAPPluginCall) {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            call.resolve()
        } catch {
            call.reject("setActive(true) failed: \(error.localizedDescription)")
        }
    }

    @objc func deactivate(_ call: CAPPluginCall) {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.resolve()
        } catch {
            call.reject("setActive(false) failed: \(error.localizedDescription)")
        }
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            notifyListeners("interruption", data: ["type": "began"])
        case .ended:
            // Re-activate the session so the web AudioContext can resume.
            try? AVAudioSession.sharedInstance().setActive(true)
            notifyListeners("interruption", data: ["type": "ended"])
        @unknown default:
            break
        }
    }
}
