# Strudel VibeLive — iOS app (Capacitor) setup

This branch (`vibelive-ios`) wraps the existing Astro web build in a native iOS
shell using **Capacitor**, and adds the two things WKWebView/Mobile Safari can't
do on their own:

| Browser gap on iOS | How this wrapper fixes it |
| --- | --- |
| **No Web MIDI API** | `NativeMIDI` Swift plugin (CoreMIDI) + a JS polyfill of `navigator.requestMIDIAccess()`. The existing `@strudel/midi` (WebMidi.js) stack then works **unchanged** — both input (CC → slider mapping) and `.midi()` output. |
| **Web Audio quirks** (routing, latency, interruption suspend) | `NativeAudioSession` Swift plugin + an `AVAudioSession` config at launch. |

## Design principle: pure wrapper

Nothing under `website/` or the other `packages/` is modified. All iOS code is
additive:

```
capacitor.config.ts                      # app id, webDir = website/dist
packages/iosbridge/                       # JS bridge + the Web MIDI polyfill (source of truth)
  web-midi-polyfill.iife.js               #   ← injected into the WebView natively
  native-plugins.mjs / audio-session.mjs / index.mjs
ios/native/                               # authored Swift you copy into the Xcode target
  NativeMIDI/NativeMIDIPlugin.swift|.m
  NativeMIDI/web-midi-polyfill.js         #   ← copy of the iosbridge file (via pnpm ios:sync-polyfill)
  NativeAudioSession/NativeAudioSessionPlugin.swift|.m
  AppDelegate.additions.swift             #   ← reference snippet to merge
docs/ios-setup.md                         # this file
```

The polyfill is **injected by `NativeMIDIPlugin.load()`** (it evaluates the JS in
the WebView at startup), so the website bundle never imports it and web/desktop
builds are untouched. On any non-iOS platform the polyfill's first line bails out.

## Prerequisites (macOS only)

- Xcode 15+ and Command Line Tools
- [CocoaPods](https://cocoapods.org/) (`sudo gem install cocoapods` or `brew install cocoapods`)
- An Apple Developer account for running on a physical device (MIDI/audio can't
  be meaningfully tested in the Simulator)
- Node + pnpm (already required by the repo)

## One-time setup

```bash
# 1. Install JS deps (adds @capacitor/core, @capacitor/ios, @capacitor/cli,
#    and links the @strudel/iosbridge workspace package).
pnpm i

# 2. Build the web app and generate the native iOS project.
pnpm build                 # produces website/dist
npx cap add ios            # generates ios/App (Xcode project + Pods)
```

> `npx cap add ios` creates `ios/App`. Commit it (it holds Info.plist, signing
> config, etc.). The heavy/derived parts — `Pods/`, the copied web `public/`,
> `xcuserdata` — are already in `.gitignore`.

### 3. Add the native plugins to the Xcode target

Copy the authored Swift/ObjC sources and the injected polyfill into the App target:

```bash
mkdir -p ios/App/App/plugins
cp -R ios/native/NativeMIDI ios/native/NativeAudioSession ios/App/App/plugins/
# the polyfill must be a bundled RESOURCE of the App target:
cp ios/native/NativeMIDI/web-midi-polyfill.js ios/App/App/
```

Then in Xcode (`pnpm ios:open`):

1. Drag `ios/App/App/plugins/**` into the **App** target (✅ "Copy items if
   needed", ✅ add to target **App**).

   > **Plugin registration — do NOT skip.** Capacitor 6 does *not* auto-discover
   > app-local plugins. The `CAP_PLUGIN(...)` macro only makes a plugin
   > *registerable*; Capacitor's auto-registration reads `capacitor.config.json`'s
   > `packageClassList`, which lists **npm packages only** (it is `[]` here). So
   > our plugins must be registered explicitly. `MainViewController.swift` does
   > this in `capacitorDidLoad()` via `bridge?.registerPluginInstance(...)`, and
   > the storyboard's view controller is set to `MainViewController` (module
   > `App`). The `integrate-ios-target.rb` script wires both automatically — if
   > you set things up by hand, do the same or the plugins' `load()` never runs
   > (no Web MIDI polyfill, no iOS default seeding).
2. Drag `ios/App/App/web-midi-polyfill.js` into the project and confirm it is in
   **Build Phases → Copy Bundle Resources** for the App target. (The plugin
   reads it from `Bundle.main` at launch.)

### 4. Info.plist keys

Add to `ios/App/App/Info.plist`:

| Key | Value | Why |
| --- | --- | --- |
| `NSBluetoothAlwaysUsageDescription` | "Connect Bluetooth MIDI devices" | BLE MIDI pairing via `showBluetoothCentral()` |
| `NSLocalNetworkUsageDescription` | "Discover MIDI and AI services on your network" | local Ollama / network MIDI |
| `UIBackgroundModes` → `audio` | (array item) | keep audio alive when the screen locks (optional; affects App Store review) |

If you use a **local Ollama** server over plain HTTP on your LAN, add an App
Transport Security exception (or run Ollama behind HTTPS):

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key><true/>
</dict>
```

Cloud AI providers (OpenAI/Anthropic/Gemini/Vrch) are HTTPS and need no ATS change.

### 5. AVAudioSession at launch

Merge `ios/native/AppDelegate.additions.swift` into the generated
`ios/App/App/AppDelegate.swift` (import `AVFoundation`, call
`configureAudioSessionAtLaunch()` in `didFinishLaunchingWithOptions`). This makes
the very first play route correctly with low latency.

### 6. Run

```bash
pnpm ios:open          # opens ios/App in Xcode
# select your device + signing team, then Run (⌘R)
```

## Day-to-day workflow

```bash
# after changing web code or the polyfill:
pnpm ios:sync          # copies polyfill, runs pnpm build, npx cap sync ios
pnpm ios:open          # or just re-run from Xcode
```

`pnpm ios:sync` runs `ios:sync-polyfill` first, so the native copy of
`web-midi-polyfill.js` always matches the source of truth in `packages/iosbridge`.

### Fast iteration (live reload)

Point the device at the Astro dev server instead of the bundled build: set
`server.url` in `capacitor.config.ts` to `http://<your-mac-ip>:3009`, set
`cleartext: true`, run `pnpm dev`, then `npx cap sync ios`. Revert before release.

## Keeping up with the stable web app

This branch tracks `vibelive` (stable). To pull a new web release in:

```bash
git checkout vibelive-ios
git merge vibelive       # only website/ + packages/ change; ios/ files don't conflict
pnpm ios:sync && pnpm ios:open
```

## How the MIDI bridge works (data flow)

```
Strudel pattern ──.midi()──▶ WebMidi.js ──▶ navigator.requestMIDIAccess()  [POLYFILL]
                                                     │
                              MIDIOutput.send(bytes) ▼
                          window.Capacitor.Plugins.NativeMIDI.send()
                                                     │ (Capacitor bridge)
                                                     ▼
                          NativeMIDIPlugin.send() ──▶ CoreMIDI ──▶ hardware/IDAM/BLE

hardware ──▶ CoreMIDI read block ──▶ notifyListeners('midimessage')
        ──▶ polyfill MIDIInput.onmidimessage ──▶ WebMidi.js ──▶ Strudel MIDI panel
```

## Known limitations / follow-ups

- **Send scheduling**: `NativeMIDIPlugin.send()` currently sends immediately
  (CoreMIDI timestamp 0) and ignores the `performance.now`-based timestamp from
  WebMidi.js. Fine for most live use; convert to `MIDITimeStamp` (mach time) for
  sample-accurate scheduling later. (See the `TODO(scheduling)` in the Swift.)
- **OSC**: not bridged on iOS yet (the desktop app uses a Rust UDP bridge). Add a
  `NativeOSC` plugin using `Network.framework` if needed.
- **Service worker / PWA**: the `@vite-pwa/astro` service worker can interfere
  inside a packaged WebView. If you see stale assets, disable the SW for the
  Capacitor build.
- **MIDI sysex** is plumbed through (`sysex` flag) but untested.
- **Audio latency** in a WebView won't match a native AudioUnit host; acceptable
  for live coding but a future option is moving synthesis to AVAudioEngine.

## License

Strudel is **AGPL-3.0-or-later**. Shipping on the App Store is fine, but you must
make the corresponding source (including this wrapper) available under the same
license.
