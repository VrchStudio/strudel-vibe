import { useCallback, useEffect, useRef, useState } from 'react';
import { atom } from 'nanostores';
import { getSliderControls, setSliderRuntimeValue } from '@strudel/codemirror';
import { settingsMap, useSettings } from '../settings.mjs';

export const MIDI_INPUT_ALL = 'all';
const MIDI_STATUS_CONTROL_CHANGE = 0xb0;

let midiAccess;
let detectTarget;

export const $midiSliderState = atom({
  inputs: [],
  status: 'MIDI slider control is off.',
  detectTarget: undefined,
  accessVersion: 0,
});

function setMidiSliderState(patch) {
  $midiSliderState.set({ ...$midiSliderState.get(), ...patch });
}

function notifyMidiAccessChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('strudel:midi-slider-access'));
  }
}

function supportsWebMidi() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value, min, max) {
  if (min === max) {
    return undefined;
  }
  return clamp((value - min) / (max - min), 0, 1);
}

function sliderValueFromNorm(slider, norm) {
  return slider.min + norm * (slider.max - slider.min);
}

function sliderNorm(slider) {
  return normalize(slider.value, slider.min, slider.max) ?? 0;
}

function pickupKey(mapping, slider) {
  return `${mapping.id}:${slider.id}`;
}

function shouldApplyPickup(state, midiNorm, currentNorm, threshold) {
  if (state.grabbed) {
    state.lastMidiNorm = midiNorm;
    return true;
  }
  const lastMidiNorm = state.lastMidiNorm;
  state.lastMidiNorm = midiNorm;
  if (Math.abs(midiNorm - currentNorm) <= threshold) {
    state.grabbed = true;
    return true;
  }
  if (lastMidiNorm == null) {
    return false;
  }
  const crossed =
    (lastMidiNorm <= currentNorm && midiNorm >= currentNorm) ||
    (lastMidiNorm >= currentNorm && midiNorm <= currentNorm);
  if (crossed) {
    state.grabbed = true;
  }
  return state.grabbed;
}

export function firstMidiSliders(sliders) {
  return sliders.slice(0, 8);
}

export function sliderLabel(slider, index) {
  if (!slider) {
    return `Slider ${index + 1}`;
  }
  return slider.name ? `${index + 1}. ${slider.name}` : `${index + 1}. Slider at ${slider.from}`;
}

function refreshMidiInputs(access = midiAccess) {
  const inputs = Array.from(access?.inputs?.values?.() ?? []);
  setMidiSliderState({ inputs });
  return inputs;
}

export async function requestMidiSliderAccess() {
  if (!supportsWebMidi()) {
    setMidiSliderState({ status: 'This browser does not expose Web MIDI inputs.' });
    return;
  }
  if (midiAccess) {
    refreshMidiInputs(midiAccess);
    notifyMidiAccessChanged();
    return midiAccess;
  }
  try {
    setMidiSliderState({ status: 'Requesting MIDI input access...' });
    const access = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess = access;
    const inputs = refreshMidiInputs(access);
    setMidiSliderState({
      status: inputs.length ? 'MIDI input access enabled.' : 'MIDI access enabled; no inputs found.',
      accessVersion: $midiSliderState.get().accessVersion + 1,
    });
    notifyMidiAccessChanged();
    return access;
  } catch (error) {
    setMidiSliderState({ status: error?.message || 'MIDI input access was denied.' });
  }
}

export function detectMidiSliderRow(index) {
  detectTarget = index;
  setMidiSliderState({
    detectTarget: index,
    status: `Move a MIDI CC control for slider ${index + 1}.`,
  });
}

function clearDetectTarget() {
  detectTarget = undefined;
  setMidiSliderState({ detectTarget: undefined });
}

function updateMappings(mappings, index, patch) {
  const next = mappings.map((mapping, i) => (i === index ? { ...mapping, ...patch } : mapping));
  settingsMap.setKey('midiSliderMappings', JSON.stringify(next));
}

function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function MidiSliderController() {
  const {
    midiSliderEnabled,
    midiSliderInputId,
    midiSliderMappings,
    midiSliderSoftTakeoverThreshold,
  } = useSettings();
  const [accessVersion, setAccessVersion] = useState(0);
  const pickupRef = useRef(new Map());
  const attachedInputsRef = useRef(new Set());
  const mappingsRef = useLatest(midiSliderMappings);
  const inputIdRef = useLatest(midiSliderInputId);
  const enabledRef = useLatest(midiSliderEnabled);
  const thresholdRef = useLatest(midiSliderSoftTakeoverThreshold);

  const handleMidiMessage = useCallback((event) => {
    if (!enabledRef.current) {
      return;
    }
    const selectedInputId = inputIdRef.current;
    if (selectedInputId !== MIDI_INPUT_ALL && event.currentTarget?.id !== selectedInputId) {
      return;
    }

    const [statusByte, cc, rawValue] = event.data;
    if ((statusByte & 0xf0) !== MIDI_STATUS_CONTROL_CHANGE) {
      return;
    }

    const channel = (statusByte & 0x0f) + 1;
    if (detectTarget != null) {
      updateMappings(mappingsRef.current, detectTarget, { channel, cc });
      clearDetectTarget();
      setMidiSliderState({ status: `Detected channel ${channel}, CC ${cc}.` });
      return;
    }

    let updated = 0;
    let waiting = 0;
    let invalidRange = 0;
    let missingSlider = 0;
    const activeSliders = firstMidiSliders(getSliderControls());
    const threshold = clamp(finiteNumber(thresholdRef.current, 0.02), 0, 0.25);

    mappingsRef.current.forEach((mapping, index) => {
      if (!mapping.enabled || mapping.channel !== channel || mapping.cc !== cc) {
        return;
      }
      const slider = activeSliders[index];
      if (!slider) {
        missingSlider++;
        return;
      }
      const midiMin = finiteNumber(mapping.midiMin, 0);
      const midiMax = finiteNumber(mapping.midiMax, 127);
      let midiNorm = normalize(rawValue, midiMin, midiMax);
      if (midiNorm == null) {
        invalidRange++;
        return;
      }
      if (mapping.reverse) {
        midiNorm = 1 - midiNorm;
      }
      const key = pickupKey(mapping, slider);
      const state = pickupRef.current.get(key) ?? { grabbed: false, lastMidiNorm: undefined };
      pickupRef.current.set(key, state);
      if (!shouldApplyPickup(state, midiNorm, sliderNorm(slider), threshold)) {
        waiting++;
        return;
      }
      setSliderRuntimeValue(slider.id, sliderValueFromNorm(slider, midiNorm), { source: 'midi' });
      updated++;
    });

    if (updated) {
      setMidiSliderState({
        status: `Updated ${updated} slider${updated === 1 ? '' : 's'} from channel ${channel}, CC ${cc}.`,
      });
    } else if (waiting) {
      setMidiSliderState({ status: `Waiting for pickup on channel ${channel}, CC ${cc}.` });
    } else if (invalidRange) {
      setMidiSliderState({ status: 'Ignored MIDI CC because its range min and max are equal.' });
    } else if (missingSlider) {
      setMidiSliderState({ status: 'Ignored MIDI CC because that row has no active slider.' });
    }
  }, []);

  useEffect(() => {
    const onSliderChange = (event) => {
      const { id, source } = event.detail ?? {};
      if (source !== 'mouse' || !id) {
        return;
      }
      firstMidiSliders(getSliderControls()).forEach((slider, index) => {
        const mapping = mappingsRef.current[index];
        if (mapping && slider.id === id) {
          pickupRef.current.set(pickupKey(mapping, slider), { grabbed: false, lastMidiNorm: undefined });
        }
      });
    };
    window.addEventListener('strudel:slider-change', onSliderChange);
    return () => window.removeEventListener('strudel:slider-change', onSliderChange);
  }, [mappingsRef]);

  useEffect(() => {
    const handleAccessChanged = () => setAccessVersion((version) => version + 1);
    window.addEventListener('strudel:midi-slider-access', handleAccessChanged);
    return () => window.removeEventListener('strudel:midi-slider-access', handleAccessChanged);
  }, []);

  useEffect(() => {
    if (!midiSliderEnabled) {
      attachedInputsRef.current.forEach((input) => input.removeEventListener('midimessage', handleMidiMessage));
      attachedInputsRef.current.clear();
      if (detectTarget != null) {
        clearDetectTarget();
      }
      setMidiSliderState({ status: 'MIDI slider control is off.' });
      return;
    }
    requestMidiSliderAccess();
  }, [handleMidiMessage, midiSliderEnabled]);

  useEffect(() => {
    if (!midiAccess || !midiSliderEnabled) {
      return;
    }

    const attachInputs = () => {
      refreshMidiInputs(midiAccess).forEach((input) => {
        if (!attachedInputsRef.current.has(input)) {
          input.addEventListener('midimessage', handleMidiMessage);
          attachedInputsRef.current.add(input);
        }
      });
    };

    const handleStateChange = () => {
      attachInputs();
      setMidiSliderState({ status: 'MIDI input list changed.' });
    };

    attachInputs();
    midiAccess.addEventListener('statechange', handleStateChange);
    return () => {
      midiAccess.removeEventListener('statechange', handleStateChange);
      attachedInputsRef.current.forEach((input) => input.removeEventListener('midimessage', handleMidiMessage));
      attachedInputsRef.current.clear();
    };
  }, [accessVersion, handleMidiMessage, midiSliderEnabled]);

  return null;
}
