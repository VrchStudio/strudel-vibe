import { useEffect, useMemo, useState } from 'react';
import { setBackgroundUrl, settingsMap, useSettings } from '../../../settings.mjs';

const connectorModeOptions = {
  bezier: 'patch cables',
  straight: 'straight lines',
  none: 'off',
};

function SelectInput({ value, options, onChange }) {
  return (
    <select
      className="p-2 bg-background rounded-md text-foreground border-foreground"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, label]) => (
        <option key={k} className="bg-background" value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function VisualsTab() {
  const { backgroundUrl = '', fontFamily, patternConnectorMode = 'bezier' } = useSettings();
  const [value, setValue] = useState(backgroundUrl);

  useEffect(() => {
    setValue(backgroundUrl ?? '');
  }, [backgroundUrl]);

  const trimmedSetting = useMemo(() => (backgroundUrl ?? '').trim(), [backgroundUrl]);
  const trimmedValue = useMemo(() => value.trim(), [value]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setBackgroundUrl(trimmedValue);
  };

  const handleClear = () => {
    setValue('');
    setBackgroundUrl('');
  };

  const connectorValue = connectorModeOptions[patternConnectorMode] ? patternConnectorMode : 'bezier';

  return (
    <div className="p-4 text-foreground text-sm space-y-6 w-full" style={{ fontFamily }}>
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-foreground/60">Pattern links</h2>
        <p className="text-foreground/80">
          Lines connect each playing sound to the value that triggered it. Pick how they look.
        </p>
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-wide">Style</label>
          <SelectInput
            value={connectorValue}
            options={connectorModeOptions}
            onChange={(mode) => settingsMap.setKey('patternConnectorMode', mode)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-foreground/60">Background Link</h2>
        <p className="text-foreground/80">
          Enter a webpage URL to render behind the interface. It ignores pointer events so you can keep
          interacting with Strudel as usual.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
            Background URL
            <input
              className="rounded border border-lineBackground bg-background p-2 text-foreground"
              type="url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://example.com/"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded border border-lineForeground px-4 py-2 disabled:opacity-50"
              disabled={trimmedValue === trimmedSetting}
            >
              apply
            </button>
            <button
              type="button"
              className="rounded border border-lineBackground px-4 py-2"
              onClick={handleClear}
              disabled={!trimmedSetting && !trimmedValue}
            >
              clear
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
