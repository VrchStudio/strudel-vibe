import { useMemo } from 'react';
import { useSettings } from '@src/settings.mjs';

export function BackgroundFrame() {
  const { backgroundUrl } = useSettings();
  const src = useMemo(() => (backgroundUrl ?? '').trim(), [backgroundUrl]);

  if (!src) {
    return null;
  }

  return (
    <iframe
      aria-hidden="true"
      tabIndex={-1}
      title="Strudel background"
      src={src}
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      style={{ border: 'none' }}
      loading="lazy"
    />
  );
}
