import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Strudel VibeLive iOS wrapper.
 *
 * This wrapper is intentionally a *pure shell*: it packages the existing
 * Astro web build (`website/dist`) into a WKWebView and adds the native
 * capabilities that Mobile Safari / WKWebView cannot provide on its own:
 *
 *   1. Web MIDI  — iOS has no Web MIDI API. The NativeMIDI plugin talks to
 *                  CoreMIDI and a JS polyfill re-implements
 *                  `navigator.requestMIDIAccess()` so the existing
 *                  `@strudel/midi` (WebMidi.js) stack works unchanged.
 *   2. Web Audio — works in WKWebView, but routing / latency / the
 *                  resume-after-interruption dance are handled by configuring
 *                  AVAudioSession natively (see NativeAudioSession + AppDelegate).
 *
 * No file under `website/` or `packages/` (other than the new
 * `packages/iosbridge`) is modified — see docs/ios-setup.md.
 */
const config: CapacitorConfig = {
  appId: 'club.vibelive.strudel',
  appName: 'Strudel VibeLive',
  // Capacitor copies this directory into ios/App/App/public on `cap sync`.
  webDir: 'website/dist',
  ios: {
    // Let the web content draw under the status bar / home indicator the way
    // the REPL expects; the app manages its own safe-area padding in CSS.
    contentInset: 'always',
    backgroundColor: '#222222',
    // We never want the system to pause the AudioContext when scrolling, etc.
    scrollEnabled: true,
  },
  server: {
    iosScheme: 'capacitor',
    // For fast iteration you can point the device at the Astro dev server on
    // your LAN instead of the bundled build. Uncomment and set your Mac's IP:
    //   url: 'http://192.168.1.42:3009',
    //   cleartext: true,
  },
  plugins: {
    // Reserved for future plugin config (e.g. SplashScreen).
  },
};

export default config;
