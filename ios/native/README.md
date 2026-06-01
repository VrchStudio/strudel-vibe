# ios/native

Authored native sources for the Strudel VibeLive iOS app. These are the **source
of truth**; you copy them into the Capacitor-generated `ios/App` project (which
does not exist until you run `npx cap add ios`).

| Path | Purpose |
| --- | --- |
| `NativeMIDI/NativeMIDIPlugin.swift` + `.m` | CoreMIDI ↔ Web MIDI bridge; injects the polyfill at startup |
| `NativeMIDI/web-midi-polyfill.js` | Copy of `packages/iosbridge/web-midi-polyfill.iife.js` (keep in sync via `pnpm ios:sync-polyfill`) — bundled as an App resource |
| `NativeAudioSession/NativeAudioSessionPlugin.swift` + `.m` | AVAudioSession config + interruption events |
| `IOSDefaults/IOSDefaultsPlugin.swift` + `.m` | Seeds first-launch UI defaults that fit the iPhone (e.g. bottom panel) into the web app's settings store, only if unset |
| `MainViewController/MainViewController.swift` | Custom `CAPBridgeViewController` that **registers the app-local plugins** above. Required: Capacitor 6 only auto-registers npm plugins, so without this the local plugins' `load()` never runs. |
| `AppDelegate.additions.swift` | Reference snippet to merge into the generated `AppDelegate.swift` |

> **Plugin registration (important):** App-local plugins are NOT auto-discovered
> by Capacitor 6. `MainViewController.capacitorDidLoad()` registers them via
> `bridge?.registerPluginInstance(...)`, and the storyboard
> (`App/Base.lproj/Main.storyboard`) is pointed at `MainViewController`. The
> `integrate-ios-target.rb` script wires both automatically.

See [`docs/ios-setup.md`](../../docs/ios-setup.md) for the full, step-by-step
build instructions.

> Do **not** edit `NativeMIDI/web-midi-polyfill.js` directly — edit
> `packages/iosbridge/web-midi-polyfill.iife.js` and run `pnpm ios:sync-polyfill`.
