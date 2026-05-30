/*
@strudel/iosbridge — native bridge for the Strudel VibeLive iOS app.

Design goal: keep the iOS build a *pure wrapper*. Nothing under website/ or the
other packages/ is modified. The two browser gaps on iOS are filled natively:

  • Web MIDI  — polyfilled by web-midi-polyfill.iife.js, which is INJECTED into
                the WKWebView by NativeMIDIPlugin.load() at startup. It is not
                imported by the website bundle, so web/desktop builds are
                untouched. (See ios/native + docs/ios-setup.md.)

  • Web Audio — AVAudioSession is configured natively; setupAudioSession() (here)
                re-asserts config and resumes the AudioContext after interruptions.

If you ever prefer to install the bridge from the JS side instead of via native
injection, call `setupIOSBridge()` from a Capacitor-guarded entry point.
*/
export * from './native-plugins.mjs';
export { setupAudioSession } from './audio-session.mjs';

import { isIOSApp } from './native-plugins.mjs';
import { setupAudioSession } from './audio-session.mjs';

/**
 * One-shot initialiser for the native iOS bridge. Safe to call anywhere — it is
 * a no-op outside the native iOS app.
 *
 * Note: the Web MIDI polyfill is installed by the native plugin (injected
 * script), so it is already active by the time this runs. This function only
 * wires up the audio session.
 */
export async function setupIOSBridge(options = {}) {
  if (!isIOSApp()) return false;
  await setupAudioSession(options.audio);
  return true;
}
