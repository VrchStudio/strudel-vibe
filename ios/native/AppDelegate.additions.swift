//
//  AppDelegate.additions.swift  (REFERENCE SNIPPET — not a standalone file)
//  Strudel VibeLive iOS
//
//  `npx cap add ios` generates ios/App/App/AppDelegate.swift. Merge the marked
//  lines below into that generated file. This pre-configures AVAudioSession at
//  launch (before the WKWebView creates its AudioContext) so the very first
//  play has the right route/latency, even before JS calls NativeAudioSession.
//
//  See docs/ios-setup.md step 5.
//
import UIKit
import AVFoundation   // <-- ADD this import to the generated AppDelegate.swift

// Inside application(_:didFinishLaunchingWithOptions:) add:
//
//   configureAudioSessionAtLaunch()
//   return true
//
// And add this method to the AppDelegate class:

func configureAudioSessionAtLaunch() {
    let session = AVAudioSession.sharedInstance()
    do {
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
    } catch {
        print("[StrudelVibeLive] AVAudioSession launch config failed: \(error)")
    }
}

// Prevent the device from auto-locking while the app is in use (a live
// performance shouldn't be interrupted by the screen dimming/locking).
// Add the marked lines to the generated stubs:
//
//   func applicationDidBecomeActive(_ application: UIApplication) {
//       application.isIdleTimerDisabled = true     // <-- ADD
//   }
//
//   func applicationDidEnterBackground(_ application: UIApplication) {
//       application.isIdleTimerDisabled = false    // <-- ADD (restore normal auto-lock)
//   }
