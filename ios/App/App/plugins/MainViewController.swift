//
//  MainViewController.swift
//  Strudel VibeLive iOS
//
//  Custom Capacitor bridge view controller whose ONLY job is to register our
//  app-local plugins.
//
//  WHY THIS EXISTS:
//  Capacitor 6 only auto-registers plugins that ship as npm packages (it reads
//  capacitor.config.json's plugin list). Plugins authored directly in the app
//  target — NativeMIDI, NativeAudioSession, IOSDefaults — are NOT discovered, so
//  their load() lifecycle never runs. Registering them here fixes that.
//
//  capacitorDidLoad() is invoked from CAPBridgeViewController.loadView(), which
//  runs BEFORE loadWebView() (called later in viewDidLoad). So any document-start
//  WKUserScript a plugin adds in its load() — e.g. IOSDefaults seeding the panel
//  position, or the Web MIDI polyfill — is in place before the web app loads.
//
//  Wired up by setting this class as the storyboard's view controller
//  (Base.lproj/Main.storyboard, customClass="MainViewController" module="App").
//  The integrate-ios-target.rb script applies that automatically.
//
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Order is not significant; each plugin's load() is independent.
        bridge?.registerPluginInstance(NativeMIDIPlugin())
        bridge?.registerPluginInstance(NativeAudioSessionPlugin())
        bridge?.registerPluginInstance(IOSDefaultsPlugin())
    }
}
