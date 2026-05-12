// Curated Hydra reference for the Strudel live coding agent.
// This is intentionally concise so visual mode can add the right context
// without crowding out the Strudel music reference.

export const HYDRA_REFERENCE = `# Hydra Visuals in Strudel

Hydra is available inside Strudel when the program starts with:
\`\`\`strudel
await initHydra()
\`\`\`

## Required Strudel-Hydra Rules
- Put \`await initHydra()\` or \`await initHydra({ feedStrudel: 1 })\` before any Hydra call.
- Use \`H(patternString)\` to turn a Strudel mini-notation pattern into a Hydra parameter function.
- Reuse the same pattern strings for sound and visuals when the user wants tight audio-visual sync.
- Prefer pattern sync with \`H(...)\` over audio analysis.
- Default to self-contained visible sources such as \`shape(...)\`, \`osc(...)\`, \`noise(...)\`, \`voronoi(...)\`, \`gradient(...)\`, or \`solid(...)\`.
- Do not use \`src(s0)\` as the root or only visible source. If Strudel feedback is useful, layer it into a visible Hydra generator instead.
- \`H(...)\` returns a plain JavaScript function for Hydra, not a Strudel pattern. Never call Strudel pattern methods after \`H(...)\`: no \`H(...).add()\`, \`H(...).sub()\`, \`H(...).mul()\`, \`H(...).div()\`, \`H(...).range()\`, \`H(...).slow()\`, or \`H(...).fast()\`.
- If a Hydra parameter needs an offset, scale, or slower pattern, encode that in the source pattern before wrapping it with \`H(...)\`, or use a plain Hydra numeric argument.
- Do not use microphone capture or Hydra audio analysis: no \`detectAudio\`, no \`a.fft\`, no \`a.setBins\`.
- Do not import Hydra. The Strudel REPL already exposes \`initHydra\`, \`H\`, and Hydra globals.
- End visible Hydra chains with \`.out(o0)\` or \`.out()\`.

## Strudel-Hydra Bridge
- \`initHydra()\` - create the Hydra canvas.
- \`initHydra({ feedStrudel: 1 })\` - sends Strudel's visual canvas to Hydra source \`s0\`.
- \`H("3 4 5")\` - returns a live function for Hydra numeric arguments from a Strudel pattern.
- Correct: \`shape(H("<3 4 5>"), 0.3).out(o0)\`
- Keep any transformation inside the pattern string or use a numeric Hydra argument; do not transform the return value of \`H(...)\`.
- \`src(s0)\` - optional Strudel feedback source when \`feedStrudel\` is enabled; do not make this the only/root visual source.

## Sources
- \`osc(frequency = 60, sync = 0.1, offset = 0)\` - color oscillator stripes.
- \`noise(scale = 10, offset = 0.1)\` - smooth noise texture.
- \`voronoi(scale = 5, speed = 0.3, blending = 0.3)\` - cellular texture.
- \`shape(sides = 3, radius = 0.3, smoothing = 0.01)\` - polygon mask.
- \`gradient(speed = 0)\` - color gradient.
- \`solid(r, g, b, a = 1)\` - solid color.
- \`src(texture)\` - read a source or output such as \`s0\`, \`o0\`, \`o1\`, \`o2\`, \`o3\`; use it for layering or feedback, not as the default root.

## Geometry
- \`.rotate(angle = 10, speed = 0)\`
- \`.scale(amount = 1.5, xMult = 1, yMult = 1, offsetX = 0.5, offsetY = 0.5)\`
- \`.pixelate(pixelX = 20, pixelY = 20)\`
- \`.repeat(repeatX = 3, repeatY = 3, offsetX = 0, offsetY = 0)\`
- \`.repeatX(reps = 3, offset = 0)\`
- \`.repeatY(reps = 3, offset = 0)\`
- \`.kaleid(nSides = 4)\`
- \`.scroll(scrollX = 0.5, scrollY = 0.5, speedX = 0, speedY = 0)\`
- \`.scrollX(scrollX = 0.5, speed = 0)\`
- \`.scrollY(scrollY = 0.5, speed = 0)\`

## Color
- \`.color(r = 1, g = 1, b = 1, a = 1)\`
- \`.hue(hue = 0.4)\`
- \`.colorama(amount = 0.005)\`
- \`.saturate(amount = 2)\`
- \`.brightness(amount = 0.4)\`
- \`.contrast(amount = 1.6)\`
- \`.posterize(bins = 3, gamma = 0.6)\`
- \`.thresh(threshold = 0.5, tolerance = 0.04)\`
- \`.luma(threshold = 0.5, tolerance = 0.1)\`
- \`.invert(amount = 1)\`

## Blend and Feedback
- \`.blend(texture, amount = 0.5)\`
- \`.add(texture, amount = 1)\`
- \`.sub(texture, amount = 1)\`
- \`.mult(texture, amount = 1)\`
- \`.diff(texture)\`
- \`.layer(texture)\`
- \`.mask(texture)\`
- \`src(o0)\` - feed the previous output back into a chain.

## Modulation
- \`.modulate(texture, amount = 0.1)\`
- \`.modulateScale(texture, multiple = 1, offset = 1)\`
- \`.modulateRotate(texture, multiple = 1, offset = 0)\`
- \`.modulatePixelate(texture, multiple = 10, offset = 3)\`
- \`.modulateHue(texture, amount = 1)\`
- \`.modulateKaleid(texture, nSides = 4)\`
- \`.modulateScrollX(texture, scrollX = 0.5, speed = 0)\`
- \`.modulateScrollY(texture, scrollY = 0.5, speed = 0)\`

## Output and State
- \`.out(o0)\`, \`.out(o1)\`, \`.out(o2)\`, \`.out(o3)\` - write to an output buffer.
- \`render(o0)\` - show one output. Use only when selecting a non-default output.
- \`time\` - Hydra global time, useful inside arrow functions.
- \`speed = 1\` and \`bpm = 30\` exist, but prefer Strudel \`setcpm\` plus \`H(...)\` for musical sync.
`;
