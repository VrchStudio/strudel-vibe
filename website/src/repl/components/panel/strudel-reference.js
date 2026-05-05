// Curated Strudel API reference for the coding agent.
// Replaces the old raw JSDoc dump with a concise, category-organised
// Markdown document that LLMs can parse efficiently (~4-5K tokens).

export const STRUDEL_REFERENCE = `# Strudel API Quick Reference

## Mini-Notation (inside double quotes)
Mini-notation is the pattern language used inside double-quoted strings:
- Space: sequence steps. "bd sd hh cp" plays 4 sounds per cycle
- \`*n\`: repeat. "hh*8" plays 8 hi-hats per cycle
- \`/n\`: slow down. "chord/2" plays chord over 2 cycles
- \`[a b]\`: group. "bd [hh hh] sd [hh hh]" groups events into one step
- \`<a b>\`: alternate each cycle. "<c3 e3 g3>" plays one note per cycle
- \`,\`: parallel within a pattern. "bd sd, hh*4" layers two patterns
- \`~\`: rest/silence. "bd ~ sd ~"
- \`!n\`: replicate. "bd!3 sd" same as "bd bd bd sd"
- \`@n\`: elongate. "bd@3 sd" bd takes 3/4 of the cycle
- \`?\`: random 50% chance to play
- \`a:n\`: sample index. "piano:2" plays the third sample variant

## Pattern Creation
- \`sound(name)\` / \`s(name)\` — Select a sound by name. \`sound("bd sd hh cp")\`
- \`note(n)\` — Play notes using letter names or MIDI numbers. \`note("c3 e3 g3 b3")\`
- \`n(index)\` — Pattern by sample index or scale degree. \`n("0 1 2 3").sound("piano")\`
- \`stack(p1, p2, ...)\` — Layer patterns simultaneously. \`stack(s("bd sd"), s("hh*4"))\`
- \`cat(p1, p2, ...)\` — Sequence patterns one after another.
- \`$:\` prefix — Run multiple patterns in parallel (alternative to stack):
  \`\`\`
  $: s("bd sd")
  $: note("c3 e3")
  \`\`\`

## Sound & Sample Selection
- \`.sound(name)\` / \`.s(name)\` — Set the sound or synth. \`note("c3").s("piano")\`
- \`.bank(name)\` — Select drum machine bank. \`s("bd sd").bank("RolandTR909")\`
- \`.n(index)\` — Pick a sample variant within a sound group.
- Built-in synths: \`sawtooth\`, \`square\`, \`triangle\`, \`sine\`

## Effects
- \`.gain(n)\` — Volume (0-1+). \`s("bd").gain(0.8)\`
- \`.pan(n)\` — Stereo position (0 = left, 0.5 = center, 1 = right).
- \`.lpf(freq)\` — Low-pass filter cutoff frequency. \`note("c3").lpf(800)\`
- \`.hpf(freq)\` — High-pass filter cutoff frequency.
- \`.bpf(freq)\` — Band-pass filter.
- \`.resonance(q)\` / \`.lpq(q)\` — Filter resonance.
- \`.vowel(v)\` — Vowel formant filter. \`.vowel("<a e i o>")\`
- \`.room(size)\` — Reverb amount (0-2+). \`.room(0.5)\`
- \`.roomsize(n)\` — Reverb room size parameter.
- \`.delay(time)\` — Delay wet amount (0-1). \`.delay(0.5)\`
- \`.delaytime(t)\` — Delay time.
- \`.delayfeedback(fb)\` — Delay feedback amount.
- \`.crush(bits)\` — Bitcrusher. \`.crush(4)\`
- \`.coarse(n)\` — Sample-rate reduction.
- \`.shape(amt)\` — Waveshaping distortion. \`.shape(0.5)\`
- \`.distort(amt)\` — Distortion.
- \`.phaser(depth)\` — Phaser effect.
- \`.orbit(n)\` — Assign to effect bus (each orbit has independent effects).
- \`.speed(rate)\` — Playback speed. \`.speed(2)\` = double, \`.speed(-1)\` = reverse.

## Envelope (ADSR)
- \`.attack(t)\` — Attack time in seconds.
- \`.decay(t)\` — Decay time in seconds.
- \`.sustain(level)\` — Sustain level (0-1).
- \`.release(t)\` — Release time in seconds.
- \`.adsr("a:d:s:r")\` — Shorthand. \`.adsr(".1:.1:.5:.2")\`

## Time & Rhythm
- \`.fast(n)\` — Speed up pattern. \`.fast(2)\` doubles speed.
- \`.slow(n)\` — Slow down pattern. \`.slow(2)\` halves speed.
- \`.early(t)\` — Shift pattern earlier in time.
- \`.late(t)\` — Shift pattern later in time.
- \`.rev\` — Reverse pattern order.
- \`.struct(pattern)\` — Apply rhythmic structure. \`.struct("x(3,8)")\` for euclidean.
- \`.euclid(pulses, steps)\` — Euclidean rhythm.
- \`setcps(n)\` — Set global tempo in cycles per second.
- \`setcpm(n)\` — Set global tempo in cycles per minute.

## Pattern Modifiers
- \`.every(n, fn)\` — Apply function every n cycles. \`.every(4, rev)\`
- \`.sometimes(fn)\` — Apply function ~50% of the time.
- \`.often(fn)\` — Apply function ~75% of the time.
- \`.rarely(fn)\` — Apply function ~25% of the time.
- \`.almostAlways(fn)\` — Apply function ~90% of the time.
- \`.almostNever(fn)\` — Apply function ~10% of the time.
- \`.off(time, fn)\` — Play offset copy with transformation. \`.off(1/8, x=>x.add(4))\`
- \`.jux(fn)\` — Apply function to right channel only. \`.jux(rev)\`
- \`.add(n)\` — Add value to pattern numbers.
- \`.sub(n)\` — Subtract value from pattern numbers.
- \`.mul(n)\` — Multiply pattern values.
- \`.chunk(n, fn)\` — Apply function to one chunk at a time.
- \`.ply(n)\` — Repeat each event n times.
- \`.striate(n)\` — Cut sample into n slices and play sequentially.

## Sample Manipulation
- \`.begin(pos)\` — Start position in sample (0-1).
- \`.end(pos)\` — End position in sample (0-1).
- \`.clip(n)\` — Limit event duration.
- \`.cut(n)\` — Cut group: new event in same group silences previous.
- \`.loop(n)\` — Loop the sample.
- \`.loopAt(n)\` — Loop sample to fit n cycles.
- \`.chop(n)\` — Chop sample into n equally-sized parts.
- \`.slice(total, pattern)\` — Slice sample and rearrange. \`.slice(8, "0 1 [2 3] 4")\`
- \`.splice(total, pattern)\` — Like slice but adjusts speed to fit.

## Scales & Harmony
- \`.scale(name)\` — Map numbers to a musical scale. \`.scale("C4:minor")\`
- Scale format: "Root:scale" or "RootOctave:scale". Ex: "C4:minor", "Db:mixolydian"
- Common scales: major, minor, pentatonic, dorian, mixolydian, blues, chromatic, lydian, phrygian, harmonic minor, melodic minor

## Signals (continuous values for automation)
- \`sine\` — Sine wave (0-1). \`sine.range(200, 800).slow(4)\`
- \`saw\` — Sawtooth wave (0-1).
- \`square\` — Square wave (0-1).
- \`tri\` — Triangle wave (0-1).
- \`rand\` — Random values (0-1).
- \`perlin\` — Smooth random (Perlin noise).
- \`.range(min, max)\` — Map signal to value range.
- \`.slow(n)\` / \`.fast(n)\` — Control signal oscillation speed.
- \`.segment(n)\` — Sample signal into discrete steps.

## UI Controls
- \`slider(value, min, max, step)\` — Interactive slider for live control. Returns a signal pattern.
  - Assign to a \`const\` variable for reuse and a readable label:
    \`const vol = slider(0.5, 0, 1, 0.01)\` then \`.gain(vol)\`
  - MIDI settings can map the first eight active editor sliders to external CC controls.
  - Use inline for one-off controls: \`.lpf(slider(800, 200, 4000, 1))\`
  - Use one step slider as a switch:
    \`const dropSwitch = slider(0, 0, 1, 1)\`
`;
