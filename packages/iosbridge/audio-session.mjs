/*
audio-session.mjs — Web Audio glue for the iOS app.

Web Audio *works* in WKWebView, but two things need native help:
  1. AVAudioSession must be configured (category .playback, mix-with-others,
     small IO buffer) so audio routes to the speaker with low latency and does
     not get ducked. This is done natively at launch (see AppDelegate.additions
     and NativeAudioSessionPlugin) — calling configure() here is a safe re-assert.
  2. After an interruption (phone call, Siri, route change) iOS may suspend the
     AudioContext. We listen for the native 'interruption' event and resume the
     Strudel AudioContext so playback recovers without a reload.

This module is invoked from `setupIOSBridge()` in index.mjs. It does nothing
outside the native app.
*/
import { NativeAudioSession, isIOSApp } from './native-plugins.mjs';

/**
 * Resolve Strudel's shared AudioContext if available. `@strudel/webaudio`
 * exposes `getAudioContext()` on the window in the REPL build; fall back to a
 * lazily created context otherwise.
 */
function resolveAudioContext() {
  if (typeof window === 'undefined') return null;
  if (typeof window.getAudioContext === 'function') {
    try {
      return window.getAudioContext();
    } catch {
      /* ignore */
    }
  }
  return window.__strudelAudioContext || null;
}

export async function setupAudioSession(options = {}) {
  if (!isIOSApp()) return;
  const {
    category = 'playback',
    mixWithOthers = true,
    // ~5.8ms at 44.1kHz; tune for latency vs. glitch tolerance on device.
    preferredBufferDuration = 0.005,
  } = options;

  try {
    await NativeAudioSession.configure({ category, mixWithOthers, preferredBufferDuration });
  } catch (e) {
    console.warn('[iosbridge] AVAudioSession configure failed', e);
  }

  // Resume the AudioContext when iOS ends an interruption.
  NativeAudioSession.addListener?.('interruption', async (info) => {
    if (info?.type !== 'ended') return;
    const ctx = resolveAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await NativeAudioSession.activate();
        await ctx.resume();
        console.info('[iosbridge] AudioContext resumed after interruption');
      } catch (e) {
        console.warn('[iosbridge] AudioContext resume failed', e);
      }
    }
  });
}
