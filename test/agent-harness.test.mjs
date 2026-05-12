import { describe, expect, it } from 'vitest';
import {
  getLogSignature,
  getNewSelfCorrectableLogs,
  isSelfCorrectableLog,
  prepareCodeForEditorApply,
  validateStrudelCode,
} from '../website/src/repl/components/agent/agent-harness.mjs';

describe('agent harness validation', () => {
  it('does not reject playable code for soft control-pattern arithmetic warnings', () => {
    const code = `
const kickDrop = slider(0, 0, 1.2, 0.01)

$: s("bd ~ bd [~ bd], hh*8, ~ cp ~ cp")
  .bank("RolandTR909")
  .gain(kickDrop)

$: n("<0 ~ 0 3 0 ~ 5 3>")
  .add(0)
  .scale("E2:phrygian")
  .s("sawtooth")

$: n("<7 9 11 9 7 4 2 4>")
  .scale("E5:dorian")
  .s("triangle")
  .every(4, x=>x.add(2))
`;

    expect(validateStrudelCode(code)).toEqual({ valid: true, errors: [] });
  });

  it('still rejects clear local validation failures', () => {
    const validation = validateStrudelCode('import x from "y"\n$: s("bd").every(4, x=>x.rev)');

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Strudel code must not contain import or require statements.');
    expect(validation.errors).toContain(
      'Callbacks must call pattern methods, not return method references. Use x=>x.rev() instead of x=>x.rev.',
    );
  });
});

describe('agent harness self-correction log policy', () => {
  it('ignores warnings while keeping eval errors self-correctable', () => {
    expect(isSelfCorrectableLog({ message: "[warn]: Can't do arithmetic on control pattern." })).toBe(false);
    expect(isSelfCorrectableLog({ message: 'not a number, falling back to 0', type: 'warning' })).toBe(false);
    expect(isSelfCorrectableLog({ message: '[eval] error: got "function" instead of pattern', type: 'error' })).toBe(
      true,
    );
    expect(isSelfCorrectableLog({ message: '[cyclist] error: missing output' })).toBe(true);
  });

  it('returns only new error logs after the baseline', () => {
    const baseline = [{ id: 'old-error', message: '[eval] error: old', type: 'error' }];
    const baselineSignatures = new Set(baseline.map(getLogSignature));
    const logs = baseline.concat([
      { id: 'new-warning', message: "[warn]: Can't do arithmetic on control pattern." },
      { id: 'new-error', message: '[eval] error: new', type: 'error' },
    ]);

    expect(getNewSelfCorrectableLogs(logs, baselineSignatures)).toEqual([
      { id: 'new-error', message: '[eval] error: new', type: 'error' },
    ]);
  });
});

describe('agent harness slider preservation', () => {
  it('keeps current named slider values when applying generated code', () => {
    const currentCode = `
const energy = slider(0.83, 0, 1.2, 0.01)
$: s("bd").gain(energy)
`;
    const generatedCode = `
const energy = slider(0.2, 0, 1.2, 0.01)
$: s("bd sd").gain(energy)
`;

    expect(prepareCodeForEditorApply({ code: currentCode }, generatedCode)).toContain(
      'const energy = slider(0.83, 0, 1.2, 0.01)',
    );
  });
});
