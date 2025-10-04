import { useEffect, useMemo, useState } from 'react';
import { setBackgroundUrl, useSettings } from '../../../settings.mjs';

export function BackgroundTab() {
  const { backgroundUrl = '', fontFamily } = useSettings();
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

  return (
    <div className="p-4 text-foreground text-sm space-y-4 w-full" style={{ fontFamily }}>
      <p className="text-foreground/80">
        Enter a webpage URL to render behind the interface. The iframe ignores pointer events so you can keep
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
            className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
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
    </div>
  );
}
