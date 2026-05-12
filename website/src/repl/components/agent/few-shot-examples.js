// Few-shot examples for the Strudel live coding agent.
// These canonical examples teach the LLM correct Strudel idioms.

export const FEW_SHOT_EXAMPLES = `Here are examples of correct Strudel code for reference. Study the style, chaining, and mini-notation carefully.

Example 1 — Simple drum pattern with bank:
\`\`\`strudel
sound("bd hh sd oh").bank("RolandTR909")
\`\`\`

Example 2 — Melodic pattern with effects:
\`\`\`strudel
note("c3 eb3 g3 bb3")
  .sound("sawtooth")
  .lpf(800)
  .room(0.3)
  .delay(0.25)
\`\`\`

Example 3 — Layered composition using $: for parallel patterns:
\`\`\`strudel
$: sound("bd rim").bank("RolandTR707").delay(0.5)

$: note("[~ [<[d3,a3,f4]!2 [d3,bb3,g4]!2> ~]]*2")
  .sound("gm_electric_guitar_muted")
  .delay(0.5)

$: n("<4 [3@3 4] [<2 0> ~@16] ~>")
  .scale("D4:minor")
  .sound("gm_accordion:2")
  .room(2)
  .gain(0.5)
\`\`\`

Example 4 — Bass with automated filter using signals:
\`\`\`strudel
note("<[c2 c3]*4 [bb1 bb2]*4 [f2 f3]*4 [eb2 eb3]*4>")
  .sound("sawtooth")
  .lpf(sine.range(100, 2000).slow(4))
\`\`\`

Example 5 — Chords with vowel filter:
\`\`\`strudel
note("<[c3,g3,e4] [bb2,f3,d4] [a2,f3,c4] [bb2,g3,eb4]>")
  .sound("sawtooth")
  .vowel("<a e i o>")
\`\`\`

Example 6 — Scale-based melody with offset harmony:
\`\`\`strudel
n("0 [4 <3 2>] <2 3> [~ 1]")
  .scale("<C5:minor Db5:mixolydian>/2")
  .off(1/8, x=>x.scaleTranspose(4))
  .sound("triangle")
  .room(0.5)
  .decay(0.1)
\`\`\`

Example 7 — Full song structure with stack:
\`\`\`strudel
setcpm(120/4)
stack(
  sound("bd*2, ~ sd, hh*8").bank("RolandTR909"),
  note("<c2 ab1 f1 g1>")
    .sound("sawtooth").lpf(sine.range(200, 800).slow(8)),
  note("[c4 eb4 g4]*2")
    .sound("square").gain(0.3).delay(0.5).room(0.4)
)
\`\`\`

Example 8 — Envelope shaping with ADSR:
\`\`\`strudel
note("c3 bb2 f3 eb3")
  .sound("sawtooth")
  .lpf(600)
  .attack(0.1)
  .decay(0.1)
  .sustain(0.25)
  .release(0.2)
\`\`\`

Example 9 — Global slider controls reused across patterns:
\`\`\`strudel
setcpm(118/4)

const emotion = slider(0.4, 0, 0.8, 0.01)
const energy = slider(0.83, 0, 1.2, 0.01)
const bite = slider(0.25, 0, 0.4, 0.01)

$: s("bd ~ ~ bd ~ ~ bd ~")
  .bank("RolandTR808")
  .gain(energy)
  .shape(bite)
  .lpf(80)
  .room(emotion)

$: s("~ ~ ~ [~ cp]")
  .bank("RolandTR808")
  .gain(slider(0.5, 0, 0.8, 0.01))
  .room(slider(0.9, 0, 2, 0.01))
  .delay(slider(0.28, 0, 0.7, 0.01))
  .delaytime(0.375)
  .hpf(1500)
\`\`\`
`;
