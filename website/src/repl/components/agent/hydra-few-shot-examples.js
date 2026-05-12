// Canonical Hydra-in-Strudel examples for the live coding agent.

export const HYDRA_FEW_SHOT_EXAMPLES = `Here are examples of correct Strudel + Hydra code. Use the same pattern strings to synchronize sound and visuals. Do not use microphone FFT or detectAudio. H(...) returns a plain Hydra parameter function, so never chain Strudel pattern methods after H(...).

Example 1 - Pattern-synced geometric visual:
\`\`\`strudel
await initHydra()
setcpm(128/4)

const melody = "<0 2 4 [6 7]>"
const sides = "<3 4 5 6>"
const repeats = "<2 3 4 6>"

shape(H(sides), 0.34, 0.02)
  .repeat(H(repeats), H("<2 4 3 5>"))
  .color(H("<0.9 0.2 0.4>"), H("<0.1 0.8 0.6>"), H("<0.4 0.6 1>"))
  .modulateRotate(osc(2, -0.08, 1), H("<0.08 0.16 0.22 0.12>"))
  .blend(src(o0).scale(1.01).brightness(-0.03), 0.55)
  .out(o0)

$: n(melody).scale("C4:minor").s("sawtooth").lpf(900).room(0.35)
$: s("bd ~ sd ~, hh*8").bank("RolandTR909").gain(0.8)
\`\`\`

Example 2 - Visible 8-bit techno visual with optional feedback:
\`\`\`strudel
await initHydra()
setcpm(132/4)

const bass = "<0 0 3 0 5 3 7 5>"
const blocks = "<3 4 5 6>"
const colorSteps = "<0.9 0.25 0.65 0.35>"

shape(H(blocks), 0.32, 0.01)
  .pixelate(28, 20)
  .repeat(H("<2 4 3 5>"), H("<3 2 5 4>"))
  .color(H(colorSteps), H("<0.2 0.8 1 0.35>"), H("<0.9 1 0.25 0.7>"))
  .diff(osc(H("<4 8 6 10>"), 0.05, 0.8).posterize(3, 0.6))
  .blend(src(o0).scale(1.01).brightness(-0.05), 0.3)
  .out(o0)

$: n(bass).scale("E3:minor").s("square").lpf(900).gain(0.35).room(0.15)
$: s("bd ~ bd bd, ~ cp ~ cp, hh*8").bank("RolandTR909").gain(0.8)
\`\`\`

Example 3 - Audio and visual sections change together:
\`\`\`strudel
await initHydra()
setcpm(132/4)

const chordShape = "<3 6 4 8>/2"
const chordProg = "<[0,2,4] [5,7,9] [3,5,7] [4,6,8]>"
const colorCycle = "<0.2 0.55 0.9 0.35>"

voronoi(H("<4 7 5 9>"), 0.25, 0.35)
  .color(H(colorCycle), H("<0.8 0.25 0.55 0.4>"), H("<0.5 0.9 0.3 0.7>"))
  .modulate(shape(H(chordShape), 0.32, 0.08).repeat(2, 3), H("<0.05 0.12 0.18 0.1>"))
  .layer(shape(H(chordShape), 0.18, 0.02).color(1, 1, 1, 0.35))
  .out(o0)

$: n(chordProg).scale("D4:dorian").s("triangle").room(0.6).delay(0.25)
$: s("bd ~ [~ bd] sd, hh*12").bank("RolandTR909").gain(0.75)
\`\`\`
`;
