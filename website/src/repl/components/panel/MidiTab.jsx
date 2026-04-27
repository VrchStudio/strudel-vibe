import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { getSliderControls, subscribeSliderControls } from '@strudel/codemirror';
import { settingsMap, useSettings } from '../../../settings.mjs';
import {
  $midiSliderState,
  MIDI_INPUT_ALL,
  detectMidiSliderRow,
  firstMidiSliders,
  requestMidiSliderAccess,
  sliderLabel,
} from '../../midiSliderControl.jsx';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function updateMappings(mappings, index, patch) {
  const next = mappings.map((mapping, i) => (i === index ? { ...mapping, ...patch } : mapping));
  settingsMap.setKey('midiSliderMappings', JSON.stringify(next));
}

function NumberField({ value, min, max, onChange, className = 'w-11' }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      className={`bg-background rounded border border-lineHighlight px-1 py-0.5 text-sm ${className}`}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function SpacerHeader() {
  return <th aria-hidden="true" className="w-2 px-0" />;
}

function SpacerCell() {
  return <td aria-hidden="true" className="w-2 px-0" />;
}

export function MidiTab() {
  const {
    fontFamily,
    midiSliderEnabled,
    midiSliderInputId,
    midiSliderMappings,
    midiSliderSoftTakeoverThreshold,
  } = useSettings();
  const { inputs, status, detectTarget } = useStore($midiSliderState);
  const [sliders, setSliders] = useState(() => getSliderControls());

  const sliderSummary = useMemo(() => {
    const assigned = firstMidiSliders(sliders).map((slider, index) => sliderLabel(slider, index));
    return assigned.length ? assigned.join(', ') : 'No sliders are active.';
  }, [sliders]);

  useEffect(() => subscribeSliderControls(setSliders), []);

  const toggleEnabled = async () => {
    if (midiSliderEnabled) {
      settingsMap.setKey('midiSliderEnabled', false);
      return;
    }
    const access = await requestMidiSliderAccess();
    if (access) {
      settingsMap.setKey('midiSliderEnabled', true);
    }
  };

  return (
    <div className="text-foreground p-4 space-y-4 w-full" style={{ fontFamily }}>
      <div className="flex flex-wrap items-center gap-3 font-sans">
        <p className="basis-full text-sm opacity-80">
          The first eight active CodeMirror sliders map to rows 1-8; enable MIDI sliders, click Detect, then move a MIDI CC control.
        </p>
        <button
          className="bg-background border border-lineHighlight rounded-md px-3 py-2 hover:opacity-70"
          onClick={toggleEnabled}
        >
          {midiSliderEnabled ? 'Disable MIDI sliders' : 'Enable MIDI sliders'}
        </button>
        <select
          className="p-2 bg-background rounded-md text-foreground border border-lineHighlight"
          disabled={!midiSliderEnabled || !inputs.length}
          value={midiSliderInputId}
          onChange={(event) => settingsMap.setKey('midiSliderInputId', event.target.value)}
        >
          <option value={MIDI_INPUT_ALL}>All MIDI inputs</option>
          {inputs.map((input) => (
            <option key={input.id} value={input.id}>
              {input.name || input.id}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          Pickup
          <input
            type="range"
            min={0.005}
            max={0.5}
            step={0.005}
            value={midiSliderSoftTakeoverThreshold}
            onChange={(event) => settingsMap.setKey('midiSliderSoftTakeoverThreshold', Number(event.target.value))}
          />
          {Math.round(midiSliderSoftTakeoverThreshold * 100)}%
        </label>
      </div>

      <div className="text-sm opacity-80 font-sans">{status}</div>
      <div className="text-sm opacity-80 font-sans">Active sliders: {sliderSummary}</div>

      <div className="overflow-auto font-sans">
        <table className="w-max min-w-0 border-separate border-spacing-x-1.5 border-spacing-y-1">
          <thead className="text-left text-xs opacity-70">
            <tr>
              <th className="font-normal px-0">On</th>
              <SpacerHeader />
              <th className="font-normal px-0">Slider</th>
              <SpacerHeader />
              <th className="font-normal px-0">Detect</th>
              <SpacerHeader />
              <th className="font-normal px-0">Channel</th>
              <SpacerHeader />
              <th className="font-normal px-0">CC</th>
              <SpacerHeader />
              <th className="font-normal px-0">MIDI min</th>
              <SpacerHeader />
              <th className="font-normal px-0">MIDI max</th>
              <SpacerHeader />
              <th className="font-normal px-0">Reverse</th>
            </tr>
          </thead>
          <tbody>
            {midiSliderMappings.map((mapping, index) => {
              const slider = firstMidiSliders(sliders)[index];
              return (
                <tr key={mapping.id} className="align-middle">
                  <td className="px-0">
                    <input
                      type="checkbox"
                      checked={mapping.enabled}
                      onChange={(event) => updateMappings(midiSliderMappings, index, { enabled: event.target.checked })}
                    />
                  </td>
                  <SpacerCell />
                  <td className="px-0 pr-2 text-sm opacity-90">
                    {slider ? sliderLabel(slider, index) : `${index + 1}. null`}
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <button
                      className="bg-background border border-lineHighlight rounded px-1.5 py-0.5 text-sm hover:opacity-70 disabled:opacity-40"
                      onClick={() => detectMidiSliderRow(index)}
                      disabled={!midiSliderEnabled}
                    >
                      {detectTarget === index ? 'Detecting' : 'Detect'}
                    </button>
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <NumberField
                      min={1}
                      max={16}
                      value={mapping.channel}
                      onChange={(channel) =>
                        updateMappings(midiSliderMappings, index, { channel: clamp(finiteNumber(channel, 1), 1, 16) })
                      }
                    />
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <NumberField
                      min={0}
                      max={127}
                      value={mapping.cc}
                      onChange={(cc) =>
                        updateMappings(midiSliderMappings, index, { cc: clamp(finiteNumber(cc, 0), 0, 127) })
                      }
                    />
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <NumberField
                      min={0}
                      max={127}
                      value={mapping.midiMin}
                      onChange={(midiMin) =>
                        updateMappings(midiSliderMappings, index, {
                          midiMin: clamp(finiteNumber(midiMin, 0), 0, 127),
                        })
                      }
                    />
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <NumberField
                      min={0}
                      max={127}
                      value={mapping.midiMax}
                      onChange={(midiMax) =>
                        updateMappings(midiSliderMappings, index, {
                          midiMax: clamp(finiteNumber(midiMax, 127), 0, 127),
                        })
                      }
                    />
                  </td>
                  <SpacerCell />
                  <td className="px-0">
                    <input
                      type="checkbox"
                      checked={mapping.reverse}
                      onChange={(event) => updateMappings(midiSliderMappings, index, { reverse: event.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
