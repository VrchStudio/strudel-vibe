/*
native-plugins.mjs — typed Capacitor plugin handles for the iOS app.

These are the JS counterparts of the Swift plugins in `ios/native/`. They are
optional for MIDI (the polyfill in `web-midi-polyfill.iife.js` talks to the
`NativeMIDI` plugin directly through `window.Capacitor.Plugins`), but they give
the rest of the app a clean, importable handle when running inside the wrapper.
*/
import { registerPlugin, Capacitor } from '@capacitor/core';

export const isIOSApp = () => Capacitor?.getPlatform?.() === 'ios' && Capacitor?.isNativePlatform?.();

/**
 * CoreMIDI bridge. Implemented by ios/native/NativeMIDI/NativeMIDIPlugin.swift.
 * @typedef {Object} NativeMIDIPlugin
 * @property {(opts: { sysex?: boolean }) => Promise<{ ports: Array }>} requestAccess
 * @property {() => Promise<{ ports: Array }>} listPorts
 * @property {(opts: { id: string, data: number[], timestamp?: number }) => Promise<void>} send
 * @property {(opts: { id: string }) => Promise<void>} openPort
 * @property {(opts: { id: string }) => Promise<void>} closePort
 * @property {() => Promise<void>} showBluetoothCentral
 */
export const NativeMIDI = registerPlugin('NativeMIDI');

/**
 * AVAudioSession bridge. Implemented by
 * ios/native/NativeAudioSession/NativeAudioSessionPlugin.swift.
 * @typedef {Object} NativeAudioSessionPlugin
 * @property {(opts?: { category?: string, mixWithOthers?: boolean, preferredBufferDuration?: number }) => Promise<void>} configure
 * @property {() => Promise<void>} activate
 * @property {() => Promise<void>} deactivate
 */
export const NativeAudioSession = registerPlugin('NativeAudioSession');
