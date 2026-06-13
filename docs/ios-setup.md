# Strudel VibeLive — iOS app (Capacitor) setup

This branch (`vibelive-ios`) wraps the existing Astro web build in a native iOS
shell using **Capacitor**, and adds the two things WKWebView/Mobile Safari can't
do on their own:

| Browser gap on iOS | How this wrapper fixes it |
| --- | --- |
| **No Web MIDI API** | `NativeMIDI` Swift plugin (CoreMIDI) + a JS polyfill of `navigator.requestMIDIAccess()`. The existing `@strudel/midi` (WebMidi.js) stack then works **unchanged** — both input (CC → slider mapping) and `.midi()` output. |
| **Web Audio quirks** (routing, latency, interruption suspend) | `NativeAudioSession` Swift plugin + an `AVAudioSession` config at launch. |
| **Phone-unfriendly defaults / auto-lock** | `IOSDefaults` plugin seeds the bottom panel layout on first launch; the AppDelegate keeps the screen awake while the app is active. |

## Design principle: pure wrapper

Nothing under `website/` or the other `packages/` is modified. All iOS code is
additive:

```
capacitor.config.ts                      # app id, webDir = website/dist
packages/iosbridge/                       # JS bridge + the Web MIDI polyfill (source of truth)
  web-midi-polyfill.iife.js               #   ← injected into the WebView natively
  native-plugins.mjs / audio-session.mjs / index.mjs
  scripts/integrate-ios-target.rb         #   ← wires native sources into the Xcode target
ios/native/                               # authored Swift (source of truth for the App target)
  NativeMIDI/NativeMIDIPlugin.swift|.m
  NativeMIDI/web-midi-polyfill.js         #   ← copy of the iosbridge file (via pnpm ios:sync-polyfill)
  NativeAudioSession/NativeAudioSessionPlugin.swift|.m
  IOSDefaults/IOSDefaultsPlugin.swift|.m  #   ← first-launch iPhone UI defaults (bottom panel)
  MainViewController/MainViewController.swift  # registers all 3 plugins (see note below)
  AppDelegate.additions.swift             #   ← reference snippet for Path B
ios/App/                                  # the generated Xcode project — COMMITTED (see Path A)
docs/ios-setup.md                         # this file
```

The Web MIDI polyfill is **injected by `NativeMIDIPlugin.load()`** as a
document-start `WKUserScript`, so it defines `navigator.requestMIDIAccess` before
the web app's MIDI code runs. The website bundle never imports it and web/desktop
builds are untouched. On any non-iOS platform the polyfill's first line bails out.
The polyfill resolves the native plugin **lazily** (on first call), because at
document-start Capacitor's JS runtime isn't fully initialised yet.

The three plugins are registered explicitly in
`MainViewController.capacitorDidLoad()` — see the note under **Path B** for why
this is required on Capacitor 6.

## Prerequisites (macOS only)

- Xcode 15+ and Command Line Tools
- [CocoaPods](https://cocoapods.org/) (`sudo gem install cocoapods` or `brew install cocoapods`)
- An Apple Developer account for running on a physical device (MIDI/audio can't
  be meaningfully tested in the Simulator)
- Node + pnpm (already required by the repo)
- Ruby with the `xcodeproj` gem — only for **Path B** below
  (`gem install --user-install xcodeproj`)

## Path A — build from a clone (the common case)

**The `ios/App` Xcode project is committed.** AppDelegate, the storyboard wiring,
all plugin source, and their Xcode target membership are already in the repo, so
you do **not** run `npx cap add ios` or drag files in Xcode. You only regenerate
the few build artifacts that are intentionally git-ignored (CocoaPods, the copied
web build, `capacitor.config.json`, the Cordova shim).

```bash
git checkout vibelive-ios
pnpm i                 # installs deps + links the @strudel/iosbridge workspace pkg
pnpm run ios:sync      # = ios:sync-polyfill + pnpm build + npx cap sync ios
pnpm run ios:open      # opens ios/App/App.xcworkspace in Xcode
```

`npx cap sync ios` (run by `ios:sync`) is what regenerates the git-ignored pieces:
`ios/App/Pods/`, `ios/App/App/public/` (the web build), `ios/App/App/capacitor.config.json`,
`ios/App/App/config.xml`, and `ios/capacitor-cordova-ios-plugins/`. Without it the
project won't compile from a fresh clone.

> ⚠️ **Open the _workspace_, never the project.** Use `ios/App/App.xcworkspace`
> (what `pnpm run ios:open` opens), not `App.xcodeproj`. CocoaPods only links via
> the workspace; opening the bare project gives `No such module 'Capacitor'`.

In Xcode: select your device + signing team (Signing & Capabilities → Team), then
**Run (⌘R)**. First build also compiles the Capacitor pods, so it takes a minute.

> **Test MIDI on a real device.** The Simulator has no CoreMIDI hardware, so
> device detection always shows an empty list there. Use a physical iPhone/iPad
> with a USB or Bluetooth MIDI controller.

Skip to [Info.plist keys](#info-plist-keys) for the one-time permission strings,
then [Day-to-day workflow](#day-to-day-workflow).

## Path B — regenerate the native project from scratch (disaster recovery)

Only needed if `ios/App` is deleted/corrupted or you're bumping to a new major
Capacitor version. This reproduces, from the authored sources in `ios/native/`,
exactly what is committed.

```bash
pnpm i
pnpm build                                  # produces website/dist
rm -rf ios/App ios/capacitor-cordova-ios-plugins ios/.gitignore   # if a broken ios/ exists
npx cap add ios                             # regenerates ios/App (Xcode project + Pods)
ruby packages/iosbridge/scripts/integrate-ios-target.rb   # see below
npx cap sync ios
pnpm run ios:open
```

`integrate-ios-target.rb` is the keystone — it is **idempotent** and does
everything the Xcode GUI would otherwise require by hand:

1. Copies the authored sources from `ios/native/**` into `ios/App/App/plugins/`
   and the Web MIDI polyfill to `ios/App/App/web-midi-polyfill.js`.
2. Adds those files to the **App** Xcode target (Compile Sources + Copy Bundle
   Resources for the polyfill).
3. Repoints the storyboard's view controller to `MainViewController`.

> **Why `MainViewController` matters.** Capacitor 6 does *not* auto-discover
> app-local plugins — its auto-registration only reads npm packages listed in
> `capacitor.config.json`'s `packageClassList` (which is `[]` here). So the
> plugins are registered explicitly in `MainViewController.capacitorDidLoad()`
> via `bridge?.registerPluginInstance(...)`, and the storyboard is pointed at
> `MainViewController` (module `App`). Without this, none of the plugins' `load()`
> runs — no Web MIDI polyfill, no iOS default seeding. The script handles it; if
> you ever wire things by hand, replicate both steps.

After Path B, also re-apply the `AppDelegate.swift` changes if `cap add ios`
regenerated a stock one — see [AVAudioSession at launch](#avaudiosession-at-launch).
Then commit the regenerated `ios/App` (the git-ignored artifacts stay out
automatically).

<a id="info-plist-keys"></a>
### Info.plist keys

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

<a id="avaudiosession-at-launch"></a>
### AVAudioSession & screen-wake (already in the committed AppDelegate)

The committed `ios/App/App/AppDelegate.swift` already:

- imports `AVFoundation` and calls `configureAudioSessionAtLaunch()` in
  `didFinishLaunchingWithOptions`, so the very first play routes to the speaker
  with low latency (category `.playback`, `.mixWithOthers`, small IO buffer);
- disables the idle timer while the app is active (`isIdleTimerDisabled = true`
  in `applicationDidBecomeActive`, restored on background) so the screen does not
  auto-lock during a performance.

`ios/native/AppDelegate.additions.swift` is the reference snippet for these
changes — you only need to merge it by hand if you regenerated a stock
`AppDelegate.swift` via **Path B**.

## Day-to-day workflow

```bash
# after changing web code or the polyfill:
pnpm run ios:sync          # copies polyfill, runs pnpm build, npx cap sync ios
pnpm run ios:open          # or just re-run from Xcode
```

`pnpm run ios:sync` runs `ios:sync-polyfill` first, so the native copy of
`web-midi-polyfill.js` always matches the source of truth in `packages/iosbridge`.
For native-only edits (Swift), you can skip the sync and just rebuild in Xcode.

### Fast iteration (live reload)

Point the device at the Astro dev server instead of the bundled build: set
`server.url` in `capacitor.config.ts` to `http://<your-mac-ip>:3009`, set
`cleartext: true`, run `pnpm dev`, then `npx cap sync ios`. Revert before release.

## Keeping up with the stable web app

This branch tracks `vibelive` (stable). To pull a new web release in:

```bash
git checkout vibelive-ios
git merge vibelive       # only website/ + packages/ change; ios/ files don't conflict
pnpm run ios:sync && pnpm run ios:open
```

## How the MIDI bridge works (data flow)

```
Strudel pattern ──.midi()──▶ WebMidi.js ──▶ navigator.requestMIDIAccess()  [POLYFILL]
                                                     │
                              MIDIOutput.send(bytes) ▼
                              NativeMIDI.send()  (resolved lazily by name)
                                                     │ (Capacitor bridge)
                                                     ▼
                          NativeMIDIPlugin.send() ──▶ CoreMIDI ──▶ hardware/IDAM/BLE

hardware ──▶ CoreMIDI read block ──▶ split into single messages ──▶ notifyListeners('midimessage')
        ──▶ polyfill dispatches a PLAIN { data: Uint8Array } event
        ──▶ MIDIInput.onmidimessage ──▶ WebMidi.js ──▶ Strudel MIDI panel
```

Two subtleties that were load-bearing to get this working (see git history):
- Incoming events must be delivered as a **plain object** with `data` as a
  `Uint8Array`; a real DOM `Event` throws in strict mode when you set `.target`
  (read-only), which silently dropped every message.
- The CoreMIDI source uniqueID is carried to the read block via the `refCon`
  **bit pattern**, not a pointer to a local (which dangles and yields garbage ids).

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
