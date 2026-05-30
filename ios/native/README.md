# ios/native

Authored native sources for the Strudel VibeLive iOS app. These are the **source
of truth**; you copy them into the Capacitor-generated `ios/App` project (which
does not exist until you run `npx cap add ios`).

| Path | Purpose |
| --- | --- |
| `NativeMIDI/NativeMIDIPlugin.swift` + `.m` | CoreMIDI ↔ Web MIDI bridge; injects the polyfill at startup |
| `NativeMIDI/web-midi-polyfill.js` | Copy of `packages/iosbridge/web-midi-polyfill.iife.js` (keep in sync via `pnpm ios:sync-polyfill`) — bundled as an App resource |
| `NativeAudioSession/NativeAudioSessionPlugin.swift` + `.m` | AVAudioSession config + interruption events |
| `AppDelegate.additions.swift` | Reference snippet to merge into the generated `AppDelegate.swift` |

See [`docs/ios-setup.md`](../../docs/ios-setup.md) for the full, step-by-step
build instructions.

> Do **not** edit `NativeMIDI/web-midi-polyfill.js` directly — edit
> `packages/iosbridge/web-midi-polyfill.iife.js` and run `pnpm ios:sync-polyfill`.
