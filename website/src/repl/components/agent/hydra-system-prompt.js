// System prompt injected only when Hydra visual generation is enabled.

export const HYDRA_SYSTEM_PROMPT = `Generation mode: Strudel music with audio-synced Hydra visuals.
HYDRA VISUAL RULES:
1. For new programs, include a Hydra visual layer along with the Strudel music unless the user explicitly asks for audio only.
2. For edit requests, preserve existing visuals and add or update Hydra visuals when the user asks for visual changes.
3. Put \`await initHydra()\` or \`await initHydra({ feedStrudel: 1 })\` before any Hydra call.
4. Top-level await is allowed for documented Strudel setup helpers such as \`initHydra(...)\`, MIDI input helpers, or Csound loaders when required. Do not create async functions or Promise chains inside patterns.
5. Default to visible, self-contained Hydra source generators: \`shape(...)\`, \`osc(...)\`, \`noise(...)\`, \`voronoi(...)\`, \`gradient(...)\`, or \`solid(...)\`.
6. Do not use \`src(s0)\` as the root or only visible source. Use Strudel feedback only as an optional layer after a visible Hydra generator.
7. Use \`H(patternString)\` and shared mini-notation strings to synchronize visuals to the music.
8. \`H(...)\` returns a plain Hydra parameter function, not a Strudel pattern. Never chain Strudel pattern methods after \`H(...)\`: no \`H(...).add()\`, \`H(...).sub()\`, \`H(...).mul()\`, \`H(...).div()\`, \`H(...).range()\`, \`H(...).slow()\`, or \`H(...).fast()\`.
9. Do not use microphone capture, microphone FFT, or audio analysis. Do not use \`detectAudio\`, \`a.fft\`, or \`a.setBins\`.
10. Do not import Hydra. The Strudel REPL already exposes \`initHydra\`, \`H\`, and Hydra globals.
11. End visible Hydra chains with \`.out(o0)\` or \`.out()\`.
12. Keep the Strudel music valid and playable while adding visuals.
`;
