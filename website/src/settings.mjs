import { persistentMap } from '@nanostores/persistent';
import { useStore } from '@nanostores/react';
import { register } from '@strudel/core';
import { isUdels } from './repl/util.mjs';

export const audioEngineTargets = {
  webaudio: 'webaudio',
  osc: 'osc',
};

export const defaultMidiSliderMappings = Array.from({ length: 8 }, (_, index) => ({
  id: `midi${index + 1}`,
  enabled: true,
  channel: 1,
  cc: index + 1,
  midiMin: 0,
  midiMax: 127,
  reverse: false,
}));

const DEFAULT_MIDI_SLIDER_SOFT_TAKEOVER_THRESHOLD = 0.25;

export const soundFilterType = {
  USER: 'user',
  DRUMS: 'drums',
  SAMPLES: 'samples',
  SYNTHS: 'synths',
  WAVETABLES: 'wavetables',
  ALL: 'all',
};

export const defaultSettings = {
  activeFooter: 'intro',
  keybindings: 'codemirror',
  isBracketMatchingEnabled: true,
  isBracketClosingEnabled: true,
  isLineNumbersDisplayed: true,
  isActiveLineHighlighted: true,
  isAutoCompletionEnabled: false,
  isTooltipEnabled: false,
  isFlashEnabled: true,
  isSyncEnabled: false,
  isLineWrappingEnabled: false,
  isPatternHighlightingEnabled: true,
  patternConnectorMode: 'bezier',
  isTabIndentationEnabled: false,
  isMultiCursorEnabled: false,
  theme: 'strudelTheme',
  fontFamily: 'monospace',
  fontSize: 18,
  latestCode: '',
  isZen: false,
  soundsFilter: soundFilterType.ALL,
  patternFilter: 'community',
  // panelPosition: window.innerWidth > 1000 ? 'right' : 'bottom', //FIX: does not work on astro
  panelPosition: 'right',
  isPanelPinned: false,
  isPanelOpen: true,
  togglePanelTrigger: 'click', //click | hover
  userPatterns: '{}',
  audioEngineTarget: audioEngineTargets.webaudio,
  isButtonRowHidden: false,
  isCSSAnimationDisabled: false,
  maxPolyphony: 128,
  multiChannelOrbits: false,
  backgroundUrl: '',
  midiSliderEnabled: false,
  midiSliderInputId: 'all',
  midiSliderSoftTakeoverThreshold: DEFAULT_MIDI_SLIDER_SOFT_TAKEOVER_THRESHOLD,
  midiSliderMappings: JSON.stringify(defaultMidiSliderMappings),
};

let search = null;
if (typeof window !== 'undefined') {
  search = new URLSearchParams(window.location.search);
}
// if running multiple instance in one window, it will use the settings for that instance. else default to normal
const instance = parseInt(search?.get('instance') ?? '0');
const settings_key = `strudel-settings${instance > 0 ? instance : ''}`;

export const settingsMap = persistentMap(settings_key, defaultSettings);

export const parseBoolean = (booleanlike) => ([true, 'true'].includes(booleanlike) ? true : false);

export function parseMidiSliderMappings(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      return defaultMidiSliderMappings;
    }
    return defaultMidiSliderMappings.map((fallback, index) => {
      const mapping = parsed[index] ?? {};
      return {
        ...fallback,
        ...mapping,
        enabled: parseBoolean(mapping.enabled ?? fallback.enabled),
        channel: Number(mapping.channel ?? fallback.channel),
        cc: Number(mapping.cc ?? fallback.cc),
        midiMin: Number(mapping.midiMin ?? fallback.midiMin),
        midiMax: Number(mapping.midiMax ?? fallback.midiMax),
        reverse: parseBoolean(mapping.reverse ?? fallback.reverse),
      };
    });
  } catch {
    return defaultMidiSliderMappings;
  }
}

export function useSettings() {
  const state = useStore(settingsMap);

  const userPatterns = JSON.parse(state.userPatterns);
  Object.keys(userPatterns).forEach((key) => {
    const data = userPatterns[key];
    data.id = data.id ?? key;
    userPatterns[key] = data;
  });
  return {
    ...state,
    isZen: parseBoolean(state.isZen),
    isBracketMatchingEnabled: parseBoolean(state.isBracketMatchingEnabled),
    isBracketClosingEnabled: parseBoolean(state.isBracketClosingEnabled),
    isLineNumbersDisplayed: parseBoolean(state.isLineNumbersDisplayed),
    isActiveLineHighlighted: parseBoolean(state.isActiveLineHighlighted),
    isAutoCompletionEnabled: parseBoolean(state.isAutoCompletionEnabled),
    isPatternHighlightingEnabled: parseBoolean(state.isPatternHighlightingEnabled),
    isButtonRowHidden: parseBoolean(state.isButtonRowHidden),
    isCSSAnimationDisabled: parseBoolean(state.isCSSAnimationDisabled),
    isTooltipEnabled: parseBoolean(state.isTooltipEnabled),
    isLineWrappingEnabled: parseBoolean(state.isLineWrappingEnabled),
    isFlashEnabled: parseBoolean(state.isFlashEnabled),
    isSyncEnabled: isUdels() ? true : parseBoolean(state.isSyncEnabled),
    isTabIndentationEnabled: parseBoolean(state.isTabIndentationEnabled),
    isMultiCursorEnabled: parseBoolean(state.isMultiCursorEnabled),
    fontSize: Number(state.fontSize),
    panelPosition: state.activeFooter !== '' && !isUdels() ? state.panelPosition : 'bottom', // <-- keep this 'bottom' where it is!
    isPanelPinned: parseBoolean(state.isPanelPinned),
    isPanelOpen: parseBoolean(state.isPanelOpen),
    userPatterns: userPatterns,
    multiChannelOrbits: parseBoolean(state.multiChannelOrbits),
    midiSliderEnabled: parseBoolean(state.midiSliderEnabled),
    midiSliderInputId: state.midiSliderInputId || 'all',
    midiSliderSoftTakeoverThreshold: Number(
      state.midiSliderSoftTakeoverThreshold ?? DEFAULT_MIDI_SLIDER_SOFT_TAKEOVER_THRESHOLD,
    ),
    midiSliderMappings: parseMidiSliderMappings(state.midiSliderMappings),
  };
}

export const setActiveFooter = (tab) => settingsMap.setKey('activeFooter', tab);
export const setPanelPinned = (bool) => settingsMap.setKey('isPanelPinned', bool);
export const setIsPanelOpened = (bool) => settingsMap.setKey('isPanelOpen', bool);

export const setBackgroundUrl = (url) => settingsMap.setKey('backgroundUrl', url);

export const setIsZen = (active) => settingsMap.setKey('isZen', !!active);

const patternSetting = (key) =>
  register(key, (value, pat) =>
    pat.onTrigger(() => {
      value = Array.isArray(value) ? value.join(' ') : value;
      if (value !== settingsMap.get()[key]) {
        settingsMap.setKey(key, value);
      }
      return pat;
    }, false),
  );

export const theme = patternSetting('theme');
export const fontFamily = patternSetting('fontFamily');
export const fontSize = patternSetting('fontSize');

export const settingPatterns = { theme, fontFamily, fontSize };
