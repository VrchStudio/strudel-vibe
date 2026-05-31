/*
native-plugins.mjs — typed Capacitor plugin handles for the iOS app.

These are the JS counterparts of the Swift plugins in `ios/native/`. They are
optional for MIDI (the polyfill in `web-midi-polyfill.iife.js` talks to the
`NativeMIDI` plugin directly through `window.Capacitor.Plugins`), but they give
the rest of the app a clean, importable handle when running inside the wrapper.
*/
import { registerPlugin, Capacitor } from '@capacitor/core';

export const isIOSApp = () => Capacitor?.getPlatform?.() === 'ios' && Capacitor?.isNativePlatform?.();

/*
 * CoreMIDI bridge. Implemented by ios/native/NativeMIDI/NativeMIDIPlugin.swift.
 * Methods (all return Promises):
 *   requestAccess(opts: { sysex?: boolean })        -> { ports: Port[] }
 *   listPorts()                                      -> { ports: Port[] }
 *   send(opts: { id, data: number[], timestamp? })   -> void
 *   openPort(opts: { id })                           -> void
 *   closePort(opts: { id })                          -> void
 *   showBluetoothCentral()                           -> void
 * Events: 'statechange' { ports }, 'midimessage' { id, data, timeStamp }.
 */
export const NativeMIDI = registerPlugin('NativeMIDI');

/*
 * AVAudioSession bridge. Implemented by
 * ios/native/NativeAudioSession/NativeAudioSessionPlugin.swift.
 * Methods (all return Promises):
 *   configure(opts?: { category?, mixWithOthers?, preferredBufferDuration? }) -> void
 *   activate()    -> void
 *   deactivate()  -> void
 * Events: 'interruption' { type: 'began' | 'ended' }.
 */
export const NativeAudioSession = registerPlugin('NativeAudioSession');
