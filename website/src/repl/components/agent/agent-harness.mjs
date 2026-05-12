import { transpiler } from '@strudel/transpiler';

const SOFT_WARNING_PREFIX_PATTERN = /^\[warn\]/i;
const LOG_ERROR_PATTERN = /\berror:/i;

const SLIDER_WIDGET_OPTIONS = {
  wrapAsync: false,
  addReturn: false,
  emitMiniLocations: true,
  emitWidgets: true,
};
const NUMERIC_LITERAL_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

export function extractCodeFromMessage(content) {
  if (!content) {
    return '';
  }
  const match = content.match(/```(?:[\w-]*\n)?([\s\S]*?)```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

export function buildSelfCorrectionPrompt(reason) {
  const hints = [];
  if (/Can't do arithmetic on control pattern/i.test(reason)) {
    hints.push(
      'Check for .add(), .sub(), .mul(), or .div() on sliders/control patterns or after .s()/.sound()/.bank()/.gain()/effects. Set slider ranges directly, and do numeric pattern arithmetic before converting numbers into sound events.',
    );
  }
  if (/expected hap\.value|Hint: append \.note\(\) or \.s\(\)|got "function/i.test(reason)) {
    hints.push(
      'Check callbacks that return method references, such as x=>x.rev. Use x=>x.rev() or pass the method directly when documented, such as .every(4, rev).',
    );
  }
  if (/Hydra visual graph|src\(s0\)|visible Hydra source/i.test(reason)) {
    hints.push(
      'For Hydra visuals, start the visible output from shape(), osc(), noise(), voronoi(), gradient(), or solid(). Do not use src(s0) or src(o0) as the only/root source.',
    );
  }
  const hintText = hints.length ? `\n\nLikely fixes:\n- ${hints.join('\n- ')}` : '';
  return `The code you generated produced this error when evaluated:\n\n${reason}${hintText}\n\nPlease fix the code. Respond with a complete corrected program in a \`\`\`strudel code block.`;
}

export function validateStrudelCode(code) {
  const errors = [];
  if (!code || !code.trim()) {
    return { valid: false, errors: ['Empty code block.'] };
  }
  if (/\b(?:import\s+|require\s*\()/m.test(code)) {
    errors.push('Strudel code must not contain import or require statements.');
  }
  if (/\bslider\s*\(\s*["']/m.test(code)) {
    errors.push('slider() takes numeric arguments (value, min, max, step), not string names.');
  }
  if (/\bconsole\s*\.\s*(?:log|warn|error|info)\b/.test(code)) {
    errors.push('Remove console.log/warn/error statements.');
  }
  if (/\bdocument\s*\.|\bwindow\s*\.|\bgetElementBy/.test(code)) {
    errors.push('DOM APIs (document, window) are not available in Strudel code.');
  }
  const codeWithoutAllowedSetupAwaits = code.replace(
    /^[ \t]*(?:(?:const|let|var)\s+[$\w]+\s*=\s*)?await\s+(?:initHydra|midin|midikeys|loadCsound|loadOrc)\b[^\n]*;?\s*$/gm,
    '',
  );
  if (
    /^[ \t]*async\s+function\b/m.test(code) ||
    /\b(?:new\s+Promise|Promise\s*\.)\b/.test(code) ||
    /\bawait\s+/m.test(codeWithoutAllowedSetupAwaits)
  ) {
    errors.push(
      'Avoid async functions and Promise chains in Strudel patterns. Top-level await is only allowed for documented setup helpers such as initHydra(...), midin(...), midikeys(...), loadCsound, or loadOrc.',
    );
  }
  if (/\bdetectAudio\b/.test(code) || /\ba\s*\.\s*(?:fft|setBins)\b/.test(code)) {
    errors.push('Microphone capture and microphone FFT are not allowed. Remove detectAudio, a.fft, and a.setBins.');
  }
  if (/\bH\s*\([^)]*\)\s*\.\s*(?:add|sub|mul|div|range|slow|fast)\s*\(/.test(code)) {
    errors.push(
      'Hydra H(...) returns a plain parameter function, not a Strudel pattern. Do not chain .add(), .sub(), .mul(), .div(), .range(), .slow(), or .fast() after H(...).',
    );
  }
  if (
    /\b[A-Za-z_$][\w$]*\s*=>\s*[A-Za-z_$][\w$]*\s*\.\s*(?:rev|fast|slow|add|sub|mul|div|range|degrade|degradeBy|ply)\s*(?=[,)\]\n]|$)/m.test(
      code,
    )
  ) {
    errors.push(
      'Callbacks must call pattern methods, not return method references. Use x=>x.rev() instead of x=>x.rev.',
    );
  }
  if (/\binitHydra\s*\(/.test(code)) {
    if (!/\.out\s*\(/.test(code)) {
      errors.push('Hydra visual code must end at least one visible chain with .out(o0) or .out().');
    }
    if (
      /^\s*src\s*\(\s*(?:s0|o[0-3])\s*\)[\s\S]*?\.out\s*\(/m.test(code) &&
      !/^\s*(?:shape|osc|noise|voronoi|gradient|solid)\s*\([\s\S]*?\.out\s*\(/m.test(code)
    ) {
      errors.push(
        'Hydra visual graph uses src(s0) or src(o*) as the root output. Start from a visible source such as shape(), osc(), noise(), voronoi(), gradient(), or solid(), then layer feedback sources only if needed.',
      );
    }
  }
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\\"/g, '').replace(/\\'/g, '');
    if ((stripped.match(/"/g) || []).length % 2 !== 0) {
      errors.push(`Unmatched double quote on line ${i + 1}.`);
      break;
    }
  }
  return { valid: errors.length === 0, errors };
}

function getNamedSliderValueRanges(code) {
  if (!code?.trim()) {
    return [];
  }
  try {
    const { widgets = [] } = transpiler(code, SLIDER_WIDGET_OPTIONS);
    return widgets
      .filter((widget) => widget?.type === 'slider' && widget.bindingName)
      .map((widget) => ({
        name: widget.bindingName,
        from: widget.from,
        to: widget.to,
        valueText: code.slice(widget.from, widget.to).trim(),
      }))
      .filter(({ from, to, valueText }) => Number.isFinite(from) && Number.isFinite(to) && valueText);
  } catch {
    return [];
  }
}

function getCurrentNamedSliderValues(code) {
  const values = new Map();
  for (const slider of getNamedSliderValueRanges(code)) {
    if (NUMERIC_LITERAL_PATTERN.test(slider.valueText)) {
      values.set(slider.name, slider.valueText);
    }
  }
  return values;
}

function preserveNamedSliderValues(currentCode, nextCode) {
  const currentValues = getCurrentNamedSliderValues(currentCode);
  if (!currentValues.size) {
    return nextCode;
  }

  const replacements = getNamedSliderValueRanges(nextCode)
    .filter((slider) => currentValues.has(slider.name) && NUMERIC_LITERAL_PATTERN.test(slider.valueText))
    .map((slider) => ({
      from: slider.from,
      to: slider.to,
      insert: currentValues.get(slider.name),
    }))
    .sort((a, b) => b.from - a.from);

  if (!replacements.length) {
    return nextCode;
  }

  return replacements.reduce(
    (code, replacement) => code.slice(0, replacement.from) + replacement.insert + code.slice(replacement.to),
    nextCode,
  );
}

export function prepareCodeForEditorApply(editor, code) {
  return preserveNamedSliderValues(editor?.code ?? '', code);
}

function categorizeSoundsByType(sounds) {
  const groups = {
    samples: new Set(),
    drumMachines: new Set(),
    synths: new Set(),
    wavetables: new Set(),
  };

  if (!sounds) {
    return {
      samples: [],
      drumMachines: [],
      synths: [],
      wavetables: [],
    };
  }

  Object.entries(sounds).forEach(([name, value]) => {
    if (!value?.data || name.startsWith('_')) {
      return;
    }

    const { data } = value;
    const type = data?.type;

    if (type === 'sample') {
      if (data.tag === 'drum-machines') {
        groups.drumMachines.add(name);
      } else {
        groups.samples.add(name);
      }
      return;
    }

    if (type === 'wavetable') {
      groups.wavetables.add(name);
      return;
    }

    if (type === 'synth' || type === 'soundfont') {
      groups.synths.add(name);
    }
  });

  const toList = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));

  return {
    samples: toList(groups.samples),
    drumMachines: toList(groups.drumMachines),
    synths: toList(groups.synths),
    wavetables: toList(groups.wavetables),
  };
}

export function buildSoundContextPrompt(sounds) {
  const categories = categorizeSoundsByType(sounds);
  const hasAny = Object.values(categories).some((list) => list.length > 0);
  if (!hasAny) {
    return '';
  }

  const formatLine = (label, values) => (values.length ? `${label}: ${values.join(', ')}` : `${label}: (none loaded)`);

  const lines = [
    formatLine('Samples', categories.samples),
    formatLine('Drum-machines', categories.drumMachines),
    formatLine('Synths', categories.synths),
    formatLine('Wavetables', categories.wavetables),
  ];

  return `Currently loaded Strudel sounds by category. Use only these names when choosing sounds:\n${lines.join('\n')}`;
}

export function isSelfCorrectableLog(entry) {
  const message = typeof entry?.message === 'string' ? entry.message : '';
  const type = typeof entry?.type === 'string' ? entry.type : '';

  // Warnings such as control-pattern arithmetic can still leave a playable result.
  // Let the console show them without making the agent rewrite working code.
  if (type === 'error') {
    return true;
  }
  if (type === 'warning' || SOFT_WARNING_PREFIX_PATTERN.test(message)) {
    return false;
  }
  return LOG_ERROR_PATTERN.test(message);
}

export function getLogSignature(entry) {
  return `${entry?.id ?? ''}:${entry?.count ?? 1}:${entry?.message ?? ''}`;
}

export function getNewSelfCorrectableLogs(logHistory, baselineSignatures) {
  if (!Array.isArray(logHistory) || !baselineSignatures) {
    return [];
  }
  return logHistory.filter((entry) => isSelfCorrectableLog(entry) && !baselineSignatures.has(getLogSignature(entry)));
}
