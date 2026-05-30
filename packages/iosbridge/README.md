# @strudel/iosbridge

JS-side glue between the Strudel web app and the native iOS (Capacitor/Swift)
shell. Analogous to `@strudel/desktopbridge` (Tauri), but for iOS.

This package exists so the `vibelive-ios` branch can stay a **pure wrapper**: the
web app and all other packages are unchanged; iOS-only behavior lives here and in
`ios/native/`.

## Contents

- **`web-midi-polyfill.iife.js`** — the important one. A dependency-free Web MIDI
  API polyfill backed by CoreMIDI through the `NativeMIDI` Capacitor plugin. It is
  the single source of truth and is injected into the WKWebView natively at
  startup (by `NativeMIDIPlugin.load()`), so the website bundle never imports it.
  On non-iOS platforms it bails out immediately (no-op).
- **`native-plugins.mjs`** — `registerPlugin()` handles for `NativeMIDI` and
  `NativeAudioSession`, plus `isIOSApp()`.
- **`audio-session.mjs`** — configures AVAudioSession and resumes the
  AudioContext after interruptions.
- **`index.mjs`** — `setupIOSBridge()` convenience initialiser.

## Usage

The MIDI polyfill needs no wiring — it is injected and active before Strudel
touches MIDI. To additionally manage the audio session from JS:

```js
import { setupIOSBridge } from '@strudel/iosbridge';
await setupIOSBridge(); // no-op unless running inside the native iOS app
```

See [`docs/ios-setup.md`](../../docs/ios-setup.md).
