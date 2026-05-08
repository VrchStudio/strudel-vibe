// vibe live coding experiment from vrch.ai

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { transpiler } from '@strudel/transpiler';
import { soundMap } from '@strudel/webaudio';
import { useSettings } from '../../../settings.mjs';
import { STRUDEL_REFERENCE } from './strudel-reference.js';
import { STRUDEL_SYSTEM_PROMPT } from './system-prompt.js';
import { FEW_SHOT_EXAMPLES } from './few-shot-examples.js';
import { HYDRA_SYSTEM_PROMPT } from './hydra-system-prompt.js';
import { HYDRA_REFERENCE } from './hydra-reference.js';
import { HYDRA_FEW_SHOT_EXAMPLES } from './hydra-few-shot-examples.js';
import { $strudel_log_history } from '../useLogger.jsx';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const MODEL_KEEP_ALIVE = '5m';
const MAX_CONTEXT_MESSAGES = 16;
const MAX_PERSISTED_MESSAGES = 50;
const REQUEST_TIMEOUT_MS = 180000;
const MAX_SELF_CORRECTION_RETRIES = 1;
const ERROR_CHECK_DELAY_MS = 1500;
const SERVICE_TYPES = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  VRCH: 'vrch',
};
const SERVICE_LABELS = {
  [SERVICE_TYPES.OLLAMA]: 'Ollama',
  [SERVICE_TYPES.OPENAI]: 'OpenAI',
  [SERVICE_TYPES.ANTHROPIC]: 'Anthropic',
  [SERVICE_TYPES.GEMINI]: 'Google Gemini',
  [SERVICE_TYPES.VRCH]: 'Vrch AI',
};
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_BROWSER_ACCESS_HEADER = 'true';
const VRCH_MODEL_OPTIONS = [
  { label: 'fast', value: 'vrch-gateway-api-fast' },
  { label: 'pro', value: 'vrch-gateway-api-pro' },
];
const VRCH_MODELS = VRCH_MODEL_OPTIONS.map((option) => option.value);
const OPENAI_GPT5_PREFIX = /^gpt-5/i;
const OPENAI_GPT5_CHAT_ALIAS_PATTERN = /^gpt-5(?:\.\d+)?(?:-(?:mini|nano|chat-latest))?$/i;
const OPENAI_RESPONSES_ONLY_PATTERNS = [/(?:^|-)pro(?:$|-)/i, /(?:^|-)codex(?:$|-)/i];
const ANTHROPIC_LATEST_CHAT_PATTERN = /^claude-(?:opus|sonnet|haiku)-4(?:-\d+)*(?:-\d{8})?$/i;
const GEMINI_LATEST_CHAT_PREFIX_PATTERN = /^gemini-3-(?:pro|flash|nano)/i;
const GEMINI_NON_CHAT_MODEL_PATTERN =
  /(?:^|-)image(?:$|-)|(?:^|-)audio(?:$|-)|(?:^|-)tts(?:$|-)|(?:^|-)embedding(?:$|-)|(?:^|-)live(?:$|-)/i;

function normaliseVrchModel(value) {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const option = VRCH_MODEL_OPTIONS.find(
    (modelOption) => modelOption.value.toLowerCase() === trimmed || modelOption.label.toLowerCase() === trimmed,
  );
  return option?.value ?? '';
}

function isVrchChatCompatibleModel(value) {
  return Boolean(normaliseVrchModel(value));
}

function getVrchModelLabel(value) {
  const normalised = normaliseVrchModel(value);
  return VRCH_MODEL_OPTIONS.find((option) => option.value === normalised)?.label ?? value;
}

function isOpenAiChatCompatibleModel(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || !OPENAI_GPT5_CHAT_ALIAS_PATTERN.test(trimmed)) {
    return false;
  }
  return !OPENAI_RESPONSES_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isAnthropicChatCompatibleModel(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return Boolean(trimmed && ANTHROPIC_LATEST_CHAT_PATTERN.test(trimmed));
}

function getAnthropicModelFamilyKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/-\d{8}$/, '');
}

function selectLatestAnthropicModels(models) {
  const selected = [];
  const seenFamilies = new Set();

  models.forEach((id) => {
    const family = getAnthropicModelFamilyKey(id);
    if (!family || seenFamilies.has(family)) {
      return;
    }
    seenFamilies.add(family);
    selected.push(id);
  });

  return selected;
}

function getGeminiLatestFamily(value) {
  const trimmed = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (trimmed.startsWith('gemini-3-pro')) {
    return 'gemini-3-pro';
  }
  if (trimmed.startsWith('gemini-3-flash')) {
    return 'gemini-3-flash';
  }
  if (trimmed.startsWith('gemini-3-nano')) {
    return 'gemini-3-nano';
  }
  return '';
}

function isGeminiChatCompatibleModel(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || !GEMINI_LATEST_CHAT_PREFIX_PATTERN.test(trimmed)) {
    return false;
  }
  return !GEMINI_NON_CHAT_MODEL_PATTERN.test(trimmed);
}

function getGeminiModelScore(value) {
  const lower = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!lower) {
    return 0;
  }
  if (lower === 'gemini-3-pro' || lower === 'gemini-3-flash' || lower === 'gemini-3-nano') {
    return 400;
  }
  if (lower.endsWith('-latest')) {
    return 300;
  }
  if (lower === 'gemini-3-pro-preview' || lower === 'gemini-3-flash-preview' || lower === 'gemini-3-nano-preview') {
    return 200;
  }
  if (lower.includes('-preview')) {
    return 100;
  }
  return 50;
}

function selectLatestGeminiModels(models) {
  const bestByFamily = new Map();

  models.forEach((id) => {
    const family = getGeminiLatestFamily(id);
    if (!family) {
      return;
    }

    const score = getGeminiModelScore(id);
    const current = bestByFamily.get(family);
    if (!current || score > current.score || (score === current.score && id.localeCompare(current.id) > 0)) {
      bestByFamily.set(family, { id, score });
    }
  });

  return Array.from(bestByFamily.values())
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));
}

function isServiceModelCompatible(service, value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return false;
  }

  if (service === SERVICE_TYPES.OPENAI) {
    return isOpenAiChatCompatibleModel(trimmed);
  }
  if (service === SERVICE_TYPES.ANTHROPIC) {
    return isAnthropicChatCompatibleModel(trimmed);
  }
  if (service === SERVICE_TYPES.GEMINI) {
    return isGeminiChatCompatibleModel(trimmed);
  }
  if (service === SERVICE_TYPES.VRCH) {
    return isVrchChatCompatibleModel(trimmed);
  }
  if (service === SERVICE_TYPES.OLLAMA) {
    return true;
  }
  return false;
}

const STORAGE_KEYS = {
  model: 'strudel-agent:model',
  ollamaModel: 'strudel-agent:model:ollama',
  openaiModel: 'strudel-agent:model:openai',
  anthropicModel: 'strudel-agent:model:anthropic',
  geminiModel: 'strudel-agent:model:gemini',
  vrchModel: 'strudel-agent:model:vrch',
  service: 'strudel-agent:service',
  endpoint: 'strudel-agent:endpoint',
  openAiApiKey: 'strudel-agent:openai-api-key',
  anthropicApiKey: 'strudel-agent:anthropic-api-key',
  geminiApiKey: 'strudel-agent:gemini-api-key',
  vrchApiKey: 'strudel-agent:vrch-api-key',
  messages: 'strudel-agent:messages',
  autoReplace: 'strudel-agent:auto-replace',
  includeVisuals: 'strudel-agent:include-visuals',
};

const MODEL_STORAGE_KEYS = {
  [SERVICE_TYPES.OLLAMA]: STORAGE_KEYS.ollamaModel,
  [SERVICE_TYPES.OPENAI]: STORAGE_KEYS.openaiModel,
  [SERVICE_TYPES.ANTHROPIC]: STORAGE_KEYS.anthropicModel,
  [SERVICE_TYPES.GEMINI]: STORAGE_KEYS.geminiModel,
  [SERVICE_TYPES.VRCH]: STORAGE_KEYS.vrchModel,
};

const LOADING_INDICATOR_FRAMES = ['.', '..', '...'];
const LOADING_INDICATOR_INTERVAL = 400;
const AUDIO_ONLY_MODE_PROMPT = [
  'Generation mode: audio only.',
  'Generate Strudel audio code only.',
  'Keep the response focused on playable music patterns and musical changes.',
].join('\n');

function extractCodeFromMessage(content) {
  if (!content) {
    return '';
  }
  const match = content.match(/```(?:[\w-]*\n)?([\s\S]*?)```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSliderVariableNames(code) {
  const names = [];
  const sliderAssignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*slider\s*\(/g;
  let match = sliderAssignment.exec(code);
  while (match) {
    names.push(match[1]);
    match = sliderAssignment.exec(code);
  }
  return names;
}

function buildSelfCorrectionPrompt(reason) {
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

function validateStrudelCode(code) {
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
  getSliderVariableNames(code).forEach((name) => {
    const sliderArithmetic = new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*(?:add|sub|mul|div)\\s*\\(`);
    if (sliderArithmetic.test(code)) {
      errors.push(
        `Avoid arithmetic methods on slider/control pattern "${name}". Set the slider min/max to the final target range and pass ${name} directly.`,
      );
    }
  });
  if (/\bslider\s*\([^)]*\)\s*\.\s*(?:add|sub|mul|div)\s*\(/m.test(code)) {
    errors.push('Avoid arithmetic methods directly on slider() results. Set the slider min/max to the final range.');
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
  if (
    /\.(?:s|sound|bank|gain|room|delay|shape|lpf|hpf|release|clip|attack|decay|sustain|pan)\s*\([^)]*\)[\s\S]{0,500}\.(?:every|off|sometimes|often|rarely|almostAlways|almostNever)\s*\([^)]*=>\s*[A-Za-z_$][\w$]*\s*\.\s*(?:add|sub|mul|div)\s*\(/m.test(
      code,
    )
  ) {
    errors.push(
      'Do numeric pattern arithmetic before converting values into sound events. Move .add(), .sub(), .mul(), or .div() before .scale(), .s(), .sound(), .bank(), .gain(), and effects.',
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

const SLIDER_WIDGET_OPTIONS = {
  wrapAsync: false,
  addReturn: false,
  emitMiniLocations: true,
  emitWidgets: true,
};
const NUMERIC_LITERAL_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

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

function prepareCodeForEditorApply(editor, code) {
  return preserveNamedSliderValues(editor?.code ?? '', code);
}

function normaliseEndpoint(value) {
  if (!value) {
    return DEFAULT_ENDPOINT;
  }
  return value.replace(/\/$/, '');
}

const API_SERVICE_BASE_URLS = {
  [SERVICE_TYPES.OPENAI]: 'https://api.openai.com',
  [SERVICE_TYPES.ANTHROPIC]: 'https://api.anthropic.com',
  [SERVICE_TYPES.GEMINI]: 'https://generativelanguage.googleapis.com',
  [SERVICE_TYPES.VRCH]: 'https://api.vrch.ai',
};

function getApiServiceUrl(service, path) {
  const baseUrl = API_SERVICE_BASE_URLS[service] ?? '';
  if (!path) {
    return baseUrl;
  }
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function getDisplayContent(message) {
  if (!message) {
    return '';
  }
  return message.displayContent ?? message.content;
}

function renderMessageContent(content) {
  if (!content) {
    return null;
  }

  const parts = [];
  const regex = /```(?:[\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', value: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    const openFenceMatch = remaining.match(/```(?:[\w-]*)\n?([\s\S]*)$/);
    if (openFenceMatch) {
      const textBefore = remaining.slice(0, openFenceMatch.index);
      if (textBefore) {
        parts.push({ type: 'text', value: textBefore });
      }
      parts.push({ type: 'code', value: openFenceMatch[1].trimStart() });
    } else {
      parts.push({ type: 'text', value: remaining });
    }
  }

  for (let j = 1; j < parts.length; j++) {
    if (parts[j].type === 'text' && parts[j - 1].type === 'code') {
      parts[j].value = parts[j].value.replace(/^\n/, '');
    }
  }

  if (parts.length === 0) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return parts.map((part, i) =>
    part.type === 'code' ? (
      <div key={i} className="relative">
        <button
          type="button"
          className="absolute right-0 top-0 rounded border border-lineBackground bg-background px-2 py-0.5 text-xs text-foreground/60 hover:text-foreground"
          onClick={() => {
            navigator.clipboard.writeText(part.value).then(() => {
              const btn = document.querySelector(`[data-copy-index="${i}"]`);
              if (btn) {
                btn.textContent = 'copied!';
                setTimeout(() => {
                  btn.textContent = 'copy';
                }, 1500);
              }
            });
          }}
          data-copy-index={i}
        >
          copy
        </button>
        <pre className="overflow-x-auto rounded border border-lineBackground bg-background p-3 pr-16 text-sm outline outline-1 outline-foreground/20">
          <code>{part.value}</code>
        </pre>
      </div>
    ) : (
      <span key={i} className="whitespace-pre-wrap">
        {part.value}
      </span>
    ),
  );
}

const SOUND_PROMPT_HEADER = 'Currently loaded Strudel sounds by category. Use only these names when choosing sounds:';

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

function buildSoundContextPrompt(sounds) {
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

  return `${SOUND_PROMPT_HEADER}\n${lines.join('\n')}`;
}

function isSelfCorrectableLog(entry) {
  const message = typeof entry?.message === 'string' ? entry.message : '';
  const type = typeof entry?.type === 'string' ? entry.type : '';
  return (
    type === 'error' ||
    type === 'warning' ||
    /^\[warn\]/i.test(message) ||
    /\berror:/i.test(message) ||
    /Can't do arithmetic on control pattern/i.test(message)
  );
}

function getLogSignature(entry) {
  return `${entry?.id ?? ''}:${entry?.count ?? 1}:${entry?.message ?? ''}`;
}

function getNewSelfCorrectableLogs(logHistory, baselineSignatures) {
  if (!Array.isArray(logHistory) || !baselineSignatures) {
    return [];
  }
  return logHistory.filter((entry) => isSelfCorrectableLog(entry) && !baselineSignatures.has(getLogSignature(entry)));
}

export function AgentTab({ context }) {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [service, setService] = useState(SERVICE_TYPES.OLLAMA);
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [vrchApiKey, setVrchApiKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [autoReplaceEnabled, setAutoReplaceEnabled] = useState(true);
  const [includeVisualsEnabled, setIncludeVisualsEnabled] = useState(false);
  const [loadingIndicatorIndex, setLoadingIndicatorIndex] = useState(0);
  const sounds = useStore(soundMap);
  const logHistory = useStore($strudel_log_history);
  const { isZen } = useSettings();
  const containerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const lastAppliedSuggestionRef = useRef('');
  const [selfCorrectionActive, setSelfCorrectionActive] = useState(false);
  const selfCorrectionRetriesRef = useRef(0);
  const selfCorrectionLogBaselineRef = useRef(new Set());
  // Mirror the latest logHistory in a ref so the self-correction timer can
  // read fresh logs WITHOUT being a useEffect dep — otherwise every Strudel
  // log entry re-runs the effect, clears the timer, and the success branch
  // (which hides the banner) never fires.
  const logHistoryRef = useRef(logHistory);
  useEffect(() => {
    logHistoryRef.current = logHistory;
  }, [logHistory]);
  const autoSubmitRef = useRef(false);
  const modelSelectionsRef = useRef({
    [SERVICE_TYPES.OLLAMA]: '',
    [SERVICE_TYPES.OPENAI]: '',
    [SERVICE_TYPES.ANTHROPIC]: '',
    [SERVICE_TYPES.GEMINI]: '',
    [SERVICE_TYPES.VRCH]: '',
  });

  const setAutoScrollState = (value) => {
    setAutoScrollEnabled((previous) => {
      if (previous === value) {
        return previous;
      }
      return value;
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const storedService = window.localStorage.getItem(STORAGE_KEYS.service);
      const storedEndpoint = window.localStorage.getItem(STORAGE_KEYS.endpoint);
      const storedOpenAiApiKey = window.localStorage.getItem(STORAGE_KEYS.openAiApiKey);
      const storedAnthropicApiKey = window.localStorage.getItem(STORAGE_KEYS.anthropicApiKey);
      const storedGeminiApiKey = window.localStorage.getItem(STORAGE_KEYS.geminiApiKey);
      const storedVrchApiKey = window.localStorage.getItem(STORAGE_KEYS.vrchApiKey);
      const storedMessages = window.localStorage.getItem(STORAGE_KEYS.messages);
      const storedAutoReplace = window.localStorage.getItem(STORAGE_KEYS.autoReplace);
      const storedIncludeVisuals = window.localStorage.getItem(STORAGE_KEYS.includeVisuals);
      const storedOllamaModel = window.localStorage.getItem(STORAGE_KEYS.ollamaModel);
      const storedOpenAiModel = window.localStorage.getItem(STORAGE_KEYS.openaiModel);
      const storedAnthropicModel = window.localStorage.getItem(STORAGE_KEYS.anthropicModel);
      const storedGeminiModel = window.localStorage.getItem(STORAGE_KEYS.geminiModel);
      const storedVrchModel = window.localStorage.getItem(STORAGE_KEYS.vrchModel);
      const legacyStoredModel = window.localStorage.getItem(STORAGE_KEYS.model);
      const safeStoredOpenAiModel = isOpenAiChatCompatibleModel(storedOpenAiModel) ? storedOpenAiModel : '';
      const safeStoredAnthropicModel = isAnthropicChatCompatibleModel(storedAnthropicModel) ? storedAnthropicModel : '';
      const safeStoredGeminiModel = isGeminiChatCompatibleModel(storedGeminiModel) ? storedGeminiModel : '';
      const safeStoredVrchModel = normaliseVrchModel(storedVrchModel);

      const initialService =
        storedService === SERVICE_TYPES.OLLAMA ||
        storedService === SERVICE_TYPES.OPENAI ||
        storedService === SERVICE_TYPES.ANTHROPIC ||
        storedService === SERVICE_TYPES.GEMINI ||
        storedService === SERVICE_TYPES.VRCH
          ? storedService
          : SERVICE_TYPES.OLLAMA;
      const safeLegacyStoredModel = isServiceModelCompatible(initialService, legacyStoredModel)
        ? legacyStoredModel
        : '';

      const initialModelSelections = {
        [SERVICE_TYPES.OLLAMA]: storedOllamaModel || '',
        [SERVICE_TYPES.OPENAI]: safeStoredOpenAiModel,
        [SERVICE_TYPES.ANTHROPIC]: safeStoredAnthropicModel,
        [SERVICE_TYPES.GEMINI]: safeStoredGeminiModel,
        [SERVICE_TYPES.VRCH]: safeStoredVrchModel,
      };

      if (safeLegacyStoredModel && !initialModelSelections[initialService]) {
        initialModelSelections[initialService] = safeLegacyStoredModel;
      }

      modelSelectionsRef.current = initialModelSelections;

      if (initialService !== SERVICE_TYPES.OLLAMA) {
        setService(initialService);
      }

      const initialModel = initialModelSelections[initialService];
      if (initialModel) {
        setModel(initialModel);
        if (initialService === SERVICE_TYPES.OLLAMA) {
          setAvailableModels((current) => (current.length === 0 ? [initialModel] : current));
        }
      }

      if (storedEndpoint) {
        setEndpoint(storedEndpoint);
      }

      if (storedOpenAiApiKey) {
        setOpenAiApiKey(storedOpenAiApiKey);
      }

      if (storedAnthropicApiKey) {
        setAnthropicApiKey(storedAnthropicApiKey);
      }

      if (storedGeminiApiKey) {
        setGeminiApiKey(storedGeminiApiKey);
      }

      if (storedVrchApiKey) {
        setVrchApiKey(storedVrchApiKey);
      }

      if (storedMessages) {
        const parsed = JSON.parse(storedMessages);
        if (Array.isArray(parsed)) {
          setMessages(
            parsed
              .map((message) => {
                if (message && typeof message === 'object') {
                  const { role, content, displayContent } = message;
                  if (role && content) {
                    return {
                      role,
                      content,
                      ...(displayContent ? { displayContent } : {}),
                    };
                  }
                }
                return null;
              })
              .filter(Boolean),
          );
        }
      }

      if (storedAutoReplace === 'false') {
        setAutoReplaceEnabled(false);
      } else if (storedAutoReplace === 'true') {
        setAutoReplaceEnabled(true);
      }

      if (storedIncludeVisuals === 'true') {
        setIncludeVisualsEnabled(true);
      }
    } catch (storageError) {
      console.warn('[agent] unable to read saved settings', storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      modelSelectionsRef.current[service] = model || '';
      const key = MODEL_STORAGE_KEYS[service];

      if (key) {
        if (model) {
          window.localStorage.setItem(key, model);
          window.localStorage.setItem(STORAGE_KEYS.model, model);
        } else {
          window.localStorage.removeItem(key);
          window.localStorage.removeItem(STORAGE_KEYS.model);
        }
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist model', storageError);
    }
  }, [model, service]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.service, service);
    } catch (storageError) {
      console.warn('[agent] unable to persist service', storageError);
    }
  }, [service]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.endpoint, endpoint);
    } catch (storageError) {
      console.warn('[agent] unable to persist endpoint', storageError);
    }
  }, [endpoint]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (openAiApiKey) {
        window.localStorage.setItem(STORAGE_KEYS.openAiApiKey, openAiApiKey);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.openAiApiKey);
      }

      if (anthropicApiKey) {
        window.localStorage.setItem(STORAGE_KEYS.anthropicApiKey, anthropicApiKey);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.anthropicApiKey);
      }

      if (geminiApiKey) {
        window.localStorage.setItem(STORAGE_KEYS.geminiApiKey, geminiApiKey);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.geminiApiKey);
      }

      if (vrchApiKey) {
        window.localStorage.setItem(STORAGE_KEYS.vrchApiKey, vrchApiKey);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.vrchApiKey);
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist API keys', storageError);
    }
  }, [openAiApiKey, anthropicApiKey, geminiApiKey, vrchApiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.autoReplace, autoReplaceEnabled ? 'true' : 'false');
    } catch (storageError) {
      console.warn('[agent] unable to persist auto-replace preference', storageError);
    }
  }, [autoReplaceEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (includeVisualsEnabled) {
        window.localStorage.setItem(STORAGE_KEYS.includeVisuals, 'true');
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.includeVisuals);
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist visual generation preference', storageError);
    }
  }, [includeVisualsEnabled]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const getApiKeyForService = () => {
      if (service === SERVICE_TYPES.OPENAI) {
        return openAiApiKey;
      }
      if (service === SERVICE_TYPES.ANTHROPIC) {
        return anthropicApiKey;
      }
      if (service === SERVICE_TYPES.GEMINI) {
        return geminiApiKey;
      }
      if (service === SERVICE_TYPES.VRCH) {
        return vrchApiKey;
      }
      return '';
    };

    const parseErrorMessage = async (response) => {
      const text = await response.text();
      let message = text;
      try {
        const payload = JSON.parse(text);
        message = payload?.error?.message || payload?.message || payload?.error?.status || text;
      } catch {}
      return message || `Unable to fetch models (status ${response.status})`;
    };

    if (service === SERVICE_TYPES.VRCH) {
      const trimmedApiKey = vrchApiKey.trim();
      setModelsLoading(false);
      setModelsError(trimmedApiKey ? '' : 'Enter a VRCH API key.');
      setAvailableModels(VRCH_MODELS);
      setModel((current) => normaliseVrchModel(current));

      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const isApiService = service !== SERVICE_TYPES.OLLAMA;
    if (isApiService) {
      const trimmedApiKey = getApiKeyForService().trim();
      const missingApiKeyMessage =
        service === SERVICE_TYPES.OPENAI
          ? 'Enter an OpenAI API key to load chat-compatible GPT-5.x models.'
          : service === SERVICE_TYPES.ANTHROPIC
            ? 'Enter an Anthropic API key to load latest-generation Claude chat models.'
            : 'Enter a Gemini API key to load latest-generation Gemini chat models.';

      if (!trimmedApiKey) {
        setModelsLoading(false);
        setModelsError(missingApiKeyMessage);
        setAvailableModels([]);
        return () => {
          cancelled = true;
          controller.abort();
        };
      }

      const loadApiModels = async () => {
        setModelsLoading(true);
        setModelsError('');
        setAvailableModels([]);

        try {
          if (service === SERVICE_TYPES.OPENAI) {
            const response = await fetch(getApiServiceUrl(SERVICE_TYPES.OPENAI, '/v1/models'), {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${trimmedApiKey}`,
                Accept: 'application/json',
              },
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(await parseErrorMessage(response));
            }

            const payload = await response.json();
            const models = Array.isArray(payload?.data)
              ? payload.data
                  .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
                  .filter((id) => isOpenAiChatCompatibleModel(id))
              : [];
            const deduped = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));

            if (cancelled) {
              return;
            }

            if (deduped.length === 0) {
              setModelsError('No chat-compatible GPT-5.x models returned by OpenAI for this API key.');
              setAvailableModels([]);
              setModel('');
              return;
            }

            setAvailableModels(deduped);
            setModel((current) => {
              if (!current) {
                return '';
              }
              return deduped.includes(current) ? current : '';
            });
            return;
          }

          if (service === SERVICE_TYPES.ANTHROPIC) {
            const response = await fetch(getApiServiceUrl(SERVICE_TYPES.ANTHROPIC, '/v1/models'), {
              method: 'GET',
              headers: {
                'x-api-key': trimmedApiKey,
                'anthropic-version': ANTHROPIC_API_VERSION,
                'anthropic-dangerous-direct-browser-access': ANTHROPIC_BROWSER_ACCESS_HEADER,
                Accept: 'application/json',
              },
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(await parseErrorMessage(response));
            }

            const payload = await response.json();
            const models = Array.isArray(payload?.data)
              ? payload.data
                  .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
                  .filter((id) => isAnthropicChatCompatibleModel(id))
              : [];
            const latestModels = selectLatestAnthropicModels(models);

            if (cancelled) {
              return;
            }

            if (latestModels.length === 0) {
              setModelsError('No latest-generation Claude chat models returned by Anthropic for this API key.');
              setAvailableModels([]);
              setModel('');
              return;
            }

            setAvailableModels(latestModels);
            setModel((current) => {
              if (!current) {
                return '';
              }
              return latestModels.includes(current) ? current : '';
            });
            return;
          }

          if (service === SERVICE_TYPES.GEMINI) {
            const params = new URLSearchParams({
              key: trimmedApiKey,
              pageSize: '1000',
            });
            const response = await fetch(
              `${getApiServiceUrl(SERVICE_TYPES.GEMINI, '/v1beta/models')}?${params.toString()}`,
              {
                method: 'GET',
                headers: {
                  Accept: 'application/json',
                },
                signal: controller.signal,
              },
            );

            if (!response.ok) {
              throw new Error(await parseErrorMessage(response));
            }

            const payload = await response.json();
            const models = Array.isArray(payload?.models)
              ? payload.models
                  .map((entry) => {
                    const rawName = typeof entry?.name === 'string' ? entry.name.trim() : '';
                    const name = rawName.replace(/^models\//i, '');
                    const methods = Array.isArray(entry?.supportedGenerationMethods)
                      ? entry.supportedGenerationMethods
                      : [];
                    if (!methods.includes('generateContent')) {
                      return '';
                    }
                    return name;
                  })
                  .filter((id) => isGeminiChatCompatibleModel(id))
              : [];
            const latestModels = selectLatestGeminiModels(models);

            if (cancelled) {
              return;
            }

            if (latestModels.length === 0) {
              setModelsError('No latest-generation Gemini chat models returned by Gemini API for this key.');
              setAvailableModels([]);
              setModel('');
              return;
            }

            setAvailableModels(latestModels);
            setModel((current) => {
              if (!current) {
                return '';
              }
              return latestModels.includes(current) ? current : '';
            });
          }
        } catch (fetchError) {
          if (controller.signal.aborted || cancelled) {
            return;
          }

          const serviceName = SERVICE_LABELS[service] ?? 'provider';
          console.error(`[agent] unable to load ${serviceName} model list`, fetchError);
          setAvailableModels([]);
          setModelsError(fetchError?.message ?? `Unable to load models from ${serviceName}.`);
        } finally {
          if (!cancelled) {
            setModelsLoading(false);
          }
        }
      };

      loadApiModels();

      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const loadOllamaModels = async () => {
      const target = normaliseEndpoint(endpoint);
      setModelsLoading(true);
      setModelsError('');
      try {
        const response = await fetch(`${target}/api/tags`, { signal: controller.signal });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Unable to fetch models (status ${response.status})`);
        }
        const payload = await response.json();
        const models = Array.isArray(payload?.models)
          ? payload.models.map((entry) => entry?.model ?? entry?.name ?? '').filter(Boolean)
          : [];
        if (!cancelled) {
          if (models.length === 0) {
            setModelsError('No models reported by Ollama. Please download one using Ollama.');
            setAvailableModels([]);
            setModel('');
            return;
          }
          const deduped = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
          setAvailableModels(deduped);
          setModel((current) => {
            if (!current) {
              return '';
            }
            return deduped.includes(current) ? current : '';
          });
        }
      } catch (fetchError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        console.error('[agent] unable to load model list', fetchError);
        setModelsError(fetchError?.message ?? 'Unable to load models from Ollama.');
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    loadOllamaModels();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [service, endpoint, openAiApiKey, anthropicApiKey, geminiApiKey, vrchApiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const persistableMessages = messages.filter((message) => !message?.isLoading);
      const cappedMessages =
        persistableMessages.length > MAX_PERSISTED_MESSAGES
          ? persistableMessages.slice(-MAX_PERSISTED_MESSAGES)
          : persistableMessages;
      window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(cappedMessages));
    } catch (storageError) {
      console.warn('[agent] unable to persist messages', storageError);
    }
  }, [messages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !autoScrollEnabled) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
      const remaining = Math.max(distanceFromBottom, 0);
      const behavior = remaining <= 64 ? 'smooth' : 'auto';
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
      }
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, autoScrollEnabled]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return undefined;
    }

    const threshold = 16;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      const nearBottom = distanceFromBottom <= threshold;
      const isScrollingUp = scrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;

      if (nearBottom) {
        setAutoScrollState(true);
        return;
      }

      if (isScrollingUp) {
        setAutoScrollState(false);
      }
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      const container = containerRef.current;
      if (!container || !container.contains(event.target)) {
        return;
      }

      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      if (!ctrlOrMeta) {
        return;
      }

      const isPeriodKey = event.code === 'Period' || event.key === '.' || event.key === '>';

      if (isPeriodKey && event.shiftKey) {
        event.preventDefault();
        setError('');
        setMessages([]);
        lastAppliedSuggestionRef.current = '';
        selfCorrectionLogBaselineRef.current = new Set();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        context?.handleEvaluate?.();
        return;
      }

      if (isPeriodKey && !event.shiftKey) {
        if (context?.started) {
          event.preventDefault();
          context?.handleTogglePlay?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [context?.handleEvaluate, context?.handleTogglePlay, context?.started]);

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  );

  const lastSuggestionCode = useMemo(
    () => extractCodeFromMessage(latestAssistantMessage?.content ?? ''),
    [latestAssistantMessage],
  );

  const queueSelfCorrection = useCallback((reason) => {
    if (selfCorrectionRetriesRef.current >= MAX_SELF_CORRECTION_RETRIES) {
      setSelfCorrectionActive(false);
      selfCorrectionRetriesRef.current = 0;
      setError('Self-correction stopped after the maximum number of attempts.');
      return false;
    }

    selfCorrectionRetriesRef.current += 1;
    setPrompt(buildSelfCorrectionPrompt(reason));
    autoSubmitRef.current = true;
    return true;
  }, []);

  const applyCodeAndWatch = useCallback(
    (code) => {
      const editor = context?.editorRef?.current;
      if (!editor?.setCode) {
        return false;
      }

      const codeToApply = prepareCodeForEditorApply(editor, code);
      setError('');
      editor.setCode(codeToApply);
      lastAppliedSuggestionRef.current = code;
      selfCorrectionLogBaselineRef.current = new Set((logHistory ?? []).map(getLogSignature));
      setSelfCorrectionActive(true);
      setTimeout(() => {
        context?.handleEvaluate?.();
      }, 100);
      return true;
    },
    [context, logHistory],
  );

  // Always runs at stream end, regardless of the auto-replace toggle:
  // - validates the generated code so the user sees errors immediately
  // - on success: clears any prior validation error; applies iff auto-replace is on
  // - on failure: surfaces the error; only auto-submits a self-correction when
  //   auto-replace is on (manual mode lets the user decide what to do).
  const runAutoReplace = useCallback(
    (assistantContent) => {
      const code = extractCodeFromMessage(assistantContent ?? '');
      if (!code) {
        return;
      }
      if (lastAppliedSuggestionRef.current === code) {
        return;
      }
      const validation = validateStrudelCode(code);
      if (!validation.valid) {
        const validationMessage = validation.errors.join(' ');
        setError(`Code validation failed: ${validationMessage}`);
        if (autoReplaceEnabled) {
          setSelfCorrectionActive(true);
          queueSelfCorrection(`Local validation failed before evaluation:\n${validationMessage}`);
        }
        return;
      }
      setError('');
      if (autoReplaceEnabled) {
        applyCodeAndWatch(code);
      }
    },
    [applyCodeAndWatch, autoReplaceEnabled, queueSelfCorrection],
  );

  // Self-correction: watch for evaluation errors and Strudel runtime logs after code applies.
  // Note: logHistory is intentionally NOT in deps — we read its latest value via logHistoryRef
  // inside the timer. Including it would let every new log entry re-arm the 1.5s timeout, so
  // the success branch could never fire and the banner would stick.
  useEffect(() => {
    if (!selfCorrectionActive || pending) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      const newLogErrors = getNewSelfCorrectableLogs(logHistoryRef.current, selfCorrectionLogBaselineRef.current);
      const errorMessages = [];
      if (context?.error) {
        errorMessages.push(context.error?.message || String(context.error));
      }
      newLogErrors.forEach((entry) => {
        const count = entry.count && entry.count > 1 ? ` (repeated ${entry.count} times)` : '';
        errorMessages.push(`${entry.message}${count}`);
      });

      if (!errorMessages.length) {
        // Evaluation succeeded — reset.
        selfCorrectionRetriesRef.current = 0;
        setSelfCorrectionActive(false);
        return;
      }

      if (selfCorrectionRetriesRef.current >= MAX_SELF_CORRECTION_RETRIES) {
        // Max retries reached — stop.
        setSelfCorrectionActive(false);
        selfCorrectionRetriesRef.current = 0;
        return;
      }

      const errorMsg = Array.from(new Set(errorMessages)).join('\n');
      queueSelfCorrection(errorMsg);
    }, ERROR_CHECK_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [queueSelfCorrection, selfCorrectionActive, context?.error, pending]);

  // Auto-submit: triggered by the self-correction effect to resubmit programmatically.
  useEffect(() => {
    if (!autoSubmitRef.current || !prompt.trim() || pending) {
      return;
    }
    autoSubmitRef.current = false;
    handleSubmit({ preventDefault: () => {}, selfCorrection: true });
  }, [prompt, pending]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const hasLoadingMessage = messages.some((message) => message?.isLoading);
    if (!hasLoadingMessage) {
      setLoadingIndicatorIndex((previous) => (previous === 0 ? previous : 0));
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setLoadingIndicatorIndex((previous) => (previous + 1) % LOADING_INDICATOR_FRAMES.length);
    }, LOADING_INDICATOR_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [messages]);

  const soundContextPrompt = useMemo(() => buildSoundContextPrompt(sounds), [sounds]);

  const modelOptions = useMemo(() => Array.from(new Set((availableModels ?? []).filter(Boolean))), [availableModels]);

  const updateAssistantMessage = (content) => {
    setMessages((previousMessages) => {
      if (!previousMessages.length) {
        return [
          {
            role: 'assistant',
            content,
            displayContent: content,
          },
        ];
      }

      const nextMessages = [...previousMessages];
      const lastIndex = nextMessages.length - 1;
      const lastMessage = nextMessages[lastIndex];

      if (!lastMessage || lastMessage.role !== 'assistant') {
        nextMessages.push({
          role: 'assistant',
          content,
          displayContent: content,
        });
        return nextMessages;
      }

      const { isLoading: _isLoading, ...rest } = lastMessage;
      nextMessages[lastIndex] = {
        ...rest,
        content,
        displayContent: content,
      };

      return nextMessages;
    });
  };

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    const isSelfCorrectionSubmit = Boolean(event?.selfCorrection);
    const trimmed = prompt.trim();
    if (!trimmed || pending) {
      return;
    }

    const isOllama = service === SERVICE_TYPES.OLLAMA;
    const isOpenAi = service === SERVICE_TYPES.OPENAI;
    const isAnthropic = service === SERVICE_TYPES.ANTHROPIC;
    const isGemini = service === SERVICE_TYPES.GEMINI;
    const isVrch = service === SERVICE_TYPES.VRCH;
    const serviceApiKey = isOpenAi
      ? openAiApiKey
      : isAnthropic
        ? anthropicApiKey
        : isGemini
          ? geminiApiKey
          : isVrch
            ? vrchApiKey
            : '';
    const serviceLabel = SERVICE_LABELS[service] ?? 'provider';
    const serviceModels = availableModels;

    if (modelsLoading) {
      setError('Still loading available models. Please wait a moment.');
      return;
    }

    const selectedModel = model.trim();
    if (!selectedModel) {
      setError('Please choose a model before sending a message.');
      return;
    }

    if (isOllama) {
      if (!serviceModels.length) {
        setError(modelsError || 'No Ollama models detected. Download a model in Ollama before chatting.');
        return;
      }

      if (!serviceModels.includes(selectedModel)) {
        setError('The selected model is not available on the Ollama server. Please choose another model.');
        return;
      }
    } else {
      if (!serviceApiKey.trim()) {
        if (isOpenAi) {
          setError('Please provide an OpenAI API key before sending a message.');
        } else if (isAnthropic) {
          setError('Please provide an Anthropic API key before sending a message.');
        } else if (isGemini) {
          setError('Please provide a Gemini API key before sending a message.');
        } else {
          setError('Please provide a VRCH API key before sending a message.');
        }
        return;
      }

      if (!serviceModels.length) {
        if (isOpenAi) {
          setError(modelsError || 'No chat-compatible GPT-5.x models available for this OpenAI API key.');
        } else if (isAnthropic) {
          setError(modelsError || 'No latest-generation Claude chat models available for this Anthropic API key.');
        } else if (isGemini) {
          setError(modelsError || 'No latest-generation Gemini chat models available for this Gemini API key.');
        } else {
          setError(modelsError || 'No VRCH models available.');
        }
        return;
      }

      if (!serviceModels.includes(selectedModel)) {
        setError(`The selected model is not available for ${serviceLabel}. Please choose another model.`);
        return;
      }

      if (!isServiceModelCompatible(service, selectedModel)) {
        setError(
          `The selected ${serviceLabel} model is not in the latest chat-compatible generation. Choose another model.`,
        );
        return;
      }
    }

    setError('');
    setPending(true);
    setAutoScrollState(true);
    lastAppliedSuggestionRef.current = '';
    if (!isSelfCorrectionSubmit) {
      selfCorrectionRetriesRef.current = 0;
    }
    selfCorrectionLogBaselineRef.current = new Set();
    setSelfCorrectionActive(false);

    const currentCode = context?.editorRef?.current?.code ?? context?.activeCode ?? '';
    const codeContext = currentCode
      ? `

Current Strudel code:

\`\`\`strudel
${currentCode}
\`\`\`
`
      : '';

    const userMessage = {
      role: 'user',
      content: `${trimmed}${codeContext}`,
      displayContent: trimmed,
    };

    const conversation = [...messages, userMessage];

    setMessages((previousMessages) => [
      ...previousMessages,
      userMessage,
      {
        role: 'assistant',
        content: '',
        displayContent: '...',
        isLoading: true,
      },
    ]);
    setPrompt('');

    const abortController = new AbortController();
    let timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    };

    try {
      // Use displayContent for historical messages to strip stale code context,
      // and only attach current code to the latest user message.
      const historyMessages = conversation.slice(0, -1).map(({ role, displayContent, content }) => ({
        role,
        content: displayContent || content,
      }));
      const latestMessage = conversation[conversation.length - 1];

      // Window: send only the last N history messages to the API.
      // Full history stays in React state and localStorage for UI display.
      const windowedHistory = historyMessages.slice(-MAX_CONTEXT_MESSAGES);
      const modePromptMessages = includeVisualsEnabled
        ? [
            { role: 'system', content: HYDRA_SYSTEM_PROMPT },
            { role: 'system', content: HYDRA_REFERENCE },
            { role: 'system', content: HYDRA_FEW_SHOT_EXAMPLES },
          ]
        : [{ role: 'system', content: AUDIO_ONLY_MODE_PROMPT }];

      const requestMessages = [
        { role: 'system', content: STRUDEL_SYSTEM_PROMPT },
        { role: 'system', content: STRUDEL_REFERENCE },
        { role: 'system', content: FEW_SHOT_EXAMPLES },
        ...modePromptMessages,
        ...(soundContextPrompt ? [{ role: 'system', content: soundContextPrompt }] : []),
        ...windowedHistory,
        { role: latestMessage.role, content: latestMessage.content },
      ];

      if (isOllama) {
        const targetEndpoint = normaliseEndpoint(endpoint);
        const payload = {
          model: selectedModel,
          stream: true,
          keep_alive: MODEL_KEEP_ALIVE,
          messages: requestMessages,
          options: {
            temperature: 0.2,
          },
        };

        // For dev to check final payload in browser console.
        console.log('[agent] ollama request payload', payload);

        const response = await fetch(`${targetEndpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Request failed with status ${response.status}`);
        }

        setAutoScrollState(true);

        if (!response.body) {
          const payload = await response.json();
          const assistantContent = payload?.message?.content || payload?.response || '';
          if (!assistantContent) {
            throw new Error('Ollama returned an empty response.');
          }
          const trimmedContent = assistantContent.trim();
          updateAssistantMessage(trimmedContent);
          runAutoReplace(trimmedContent);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        let streamCompleted = false;

        const processLine = (line) => {
          if (!line) {
            return;
          }

          let data;
          try {
            data = JSON.parse(line);
          } catch (parseError) {
            console.warn('[agent] unable to parse stream chunk', parseError, line);
            return;
          }

          if (data?.error) {
            throw new Error(data.error);
          }

          const fragment = data?.message?.content ?? data?.response ?? '';
          if (fragment) {
            assistantContent += fragment;
            updateAssistantMessage(assistantContent);
          }

          if (data?.done) {
            streamCompleted = true;
          }
        };

        while (!streamCompleted) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) {
            buffer += decoder.decode();
            break;
          }

          resetTimeout();
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          lines.forEach((line) => {
            processLine(line.trim());
          });
        }

        buffer = `${buffer}${decoder.decode()}`.trim();
        if (buffer) {
          processLine(buffer);
        }

        const finalContent = assistantContent.trim();
        if (!finalContent) {
          throw new Error('Ollama returned an empty response.');
        }

        updateAssistantMessage(finalContent);
        runAutoReplace(finalContent);
        return;
      }

      if (isOpenAi || isVrch) {
        const trimmedApiKey = isOpenAi ? openAiApiKey.trim() : vrchApiKey.trim();
        const openAiCompatiblePayload = {
          model: selectedModel,
          stream: true,
          messages: requestMessages,
        };

        if (!(isOpenAi && OPENAI_GPT5_PREFIX.test(selectedModel)) && !isVrchChatCompatibleModel(selectedModel)) {
          openAiCompatiblePayload.temperature = 0.2;
        }

        // For dev to check final payload in browser console.
        console.log(`[agent] ${service} request payload`, openAiCompatiblePayload);

        const response = await fetch(getApiServiceUrl(service, '/v1/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${trimmedApiKey}`,
          },
          body: JSON.stringify(openAiCompatiblePayload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Request failed with status ${response.status}`);
        }

        setAutoScrollState(true);

        if (!response.body) {
          const payload = await response.json();
          const assistantContent =
            payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.delta?.content ?? '';
          if (!assistantContent) {
            throw new Error(`${serviceLabel} returned an empty response.`);
          }
          const trimmedContent = assistantContent.trim();
          updateAssistantMessage(trimmedContent);
          runAutoReplace(trimmedContent);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        let streamCompleted = false;

        const processEvent = (event) => {
          if (!event) {
            return;
          }

          const trimmedEvent = event.trim();
          if (!trimmedEvent) {
            return;
          }

          const lines = trimmedEvent.split('\n');
          lines.forEach((line) => {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) {
              return;
            }
            const data = trimmedLine.slice(5).trim();
            if (!data) {
              return;
            }
            if (data === '[DONE]') {
              streamCompleted = true;
              return;
            }
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch (parseError) {
              console.warn(`[agent] unable to parse ${service} stream chunk`, parseError, data);
              return;
            }
            if (parsed?.error?.message) {
              throw new Error(parsed.error.message);
            }
            const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : undefined;
            const delta = choice?.delta ?? {};
            const fragment = delta?.content ?? '';
            if (fragment) {
              assistantContent += fragment;
              updateAssistantMessage(assistantContent);
            }
            const finishReason = choice?.finish_reason;
            if (finishReason) {
              streamCompleted = true;
            }
          });
        };

        while (!streamCompleted) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) {
            buffer += decoder.decode();
            break;
          }

          resetTimeout();
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          events.forEach((event) => {
            processEvent(event);
          });
        }

        buffer = `${buffer}${decoder.decode()}`;
        if (buffer) {
          processEvent(buffer);
        }

        const finalContent = assistantContent.trim();
        if (!finalContent) {
          throw new Error(`${serviceLabel} returned an empty response.`);
        }

        updateAssistantMessage(finalContent);
        runAutoReplace(finalContent);
        return;
      }

      if (isAnthropic) {
        const trimmedApiKey = anthropicApiKey.trim();
        const systemPrompt = requestMessages
          .filter((entry) => entry?.role === 'system')
          .map((entry) => entry?.content ?? '')
          .filter(Boolean)
          .join('\n\n');
        const anthropicMessages = requestMessages
          .filter((entry) => entry?.role === 'user' || entry?.role === 'assistant')
          .map((entry) => ({
            role: entry.role,
            content: entry.content,
          }));
        const anthropicPayload = {
          model: selectedModel,
          max_tokens: 4096,
          stream: true,
          messages: anthropicMessages,
          temperature: 0.2,
          ...(systemPrompt ? { system: systemPrompt } : {}),
        };

        console.log('[agent] anthropic request payload', anthropicPayload);

        const response = await fetch(getApiServiceUrl(SERVICE_TYPES.ANTHROPIC, '/v1/messages'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': trimmedApiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'anthropic-dangerous-direct-browser-access': ANTHROPIC_BROWSER_ACCESS_HEADER,
          },
          body: JSON.stringify(anthropicPayload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          let message = text;
          try {
            message = JSON.parse(text)?.error?.message ?? text;
          } catch {}
          throw new Error(message || `Request failed with status ${response.status}`);
        }

        setAutoScrollState(true);

        if (!response.body) {
          const payload = await response.json();
          const assistantContent = Array.isArray(payload?.content)
            ? payload.content
                .filter((block) => block?.type === 'text')
                .map((block) => block?.text ?? '')
                .join('')
            : '';
          if (!assistantContent) {
            throw new Error('Anthropic returned an empty response.');
          }
          const trimmedContent = assistantContent.trim();
          updateAssistantMessage(trimmedContent);
          runAutoReplace(trimmedContent);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';
        let streamCompleted = false;

        const processEvent = (event) => {
          if (!event) {
            return;
          }
          const trimmedEvent = event.trim();
          if (!trimmedEvent) {
            return;
          }
          const lines = trimmedEvent.split('\n');
          let eventType = '';
          let eventData = '';
          lines.forEach((line) => {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              eventData += line.slice(5).trim();
            }
          });
          if (!eventData) {
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(eventData);
          } catch (parseError) {
            console.warn('[agent] unable to parse Anthropic stream chunk', parseError, eventData);
            return;
          }
          if (parsed?.error?.message) {
            throw new Error(parsed.error.message);
          }
          if (eventType === 'content_block_delta' && parsed?.delta?.type === 'text_delta') {
            const fragment = parsed.delta.text ?? '';
            if (fragment) {
              assistantContent += fragment;
              updateAssistantMessage(assistantContent);
            }
          }
          if (eventType === 'message_stop') {
            streamCompleted = true;
          }
        };

        while (!streamCompleted) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) {
            buffer += decoder.decode();
            break;
          }

          resetTimeout();
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          events.forEach((evt) => {
            processEvent(evt);
          });
        }

        buffer = `${buffer}${decoder.decode()}`;
        if (buffer) {
          processEvent(buffer);
        }

        const finalContent = assistantContent.trim();
        if (!finalContent) {
          throw new Error('Anthropic returned an empty response.');
        }

        updateAssistantMessage(finalContent);
        runAutoReplace(finalContent);
        return;
      }

      if (isGemini) {
        const trimmedApiKey = geminiApiKey.trim();
        const systemPrompt = requestMessages
          .filter((entry) => entry?.role === 'system')
          .map((entry) => entry?.content ?? '')
          .filter(Boolean)
          .join('\n\n');
        const geminiMessages = requestMessages
          .filter((entry) => entry?.role === 'user' || entry?.role === 'assistant')
          .map((entry) => ({
            role: entry.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: entry.content }],
          }));
        const geminiPayload = {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.2,
          },
          ...(systemPrompt
            ? {
                systemInstruction: {
                  parts: [{ text: systemPrompt }],
                },
              }
            : {}),
        };
        const params = new URLSearchParams({ key: trimmedApiKey, alt: 'sse' });

        console.log('[agent] gemini request payload', geminiPayload);

        const response = await fetch(
          `${getApiServiceUrl(SERVICE_TYPES.GEMINI, `/v1beta/models/${encodeURIComponent(selectedModel)}:streamGenerateContent`)}?${params.toString()}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(geminiPayload),
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          const text = await response.text();
          let message = text;
          try {
            message = JSON.parse(text)?.error?.message ?? text;
          } catch {}
          throw new Error(message || `Request failed with status ${response.status}`);
        }

        setAutoScrollState(true);

        if (!response.body) {
          const payload = await response.json();
          let assistantContent = '';
          if (Array.isArray(payload?.candidates)) {
            payload.candidates.forEach((candidate) => {
              const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
              parts.forEach((part) => {
                if (typeof part?.text === 'string') {
                  assistantContent += part.text;
                }
              });
            });
          }
          if (!assistantContent) {
            const blockReason = payload?.promptFeedback?.blockReason;
            if (blockReason) {
              throw new Error(`Gemini blocked the response (${blockReason}).`);
            }
            throw new Error('Gemini returned an empty response.');
          }
          const trimmedContent = assistantContent.trim();
          updateAssistantMessage(trimmedContent);
          runAutoReplace(trimmedContent);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantContent = '';

        const processEvent = (event) => {
          if (!event) {
            return;
          }
          const trimmedEvent = event.trim();
          if (!trimmedEvent) {
            return;
          }
          const lines = trimmedEvent.split('\n');
          lines.forEach((line) => {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) {
              return;
            }
            const data = trimmedLine.slice(5).trim();
            if (!data) {
              return;
            }
            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch (parseError) {
              console.warn('[agent] unable to parse Gemini stream chunk', parseError, data);
              return;
            }
            if (parsed?.error?.message) {
              throw new Error(parsed.error.message);
            }
            if (Array.isArray(parsed?.candidates)) {
              parsed.candidates.forEach((candidate) => {
                const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
                parts.forEach((part) => {
                  if (typeof part?.text === 'string') {
                    assistantContent += part.text;
                    updateAssistantMessage(assistantContent);
                  }
                });
              });
            }
            if (parsed?.promptFeedback?.blockReason) {
              throw new Error(`Gemini blocked the response (${parsed.promptFeedback.blockReason}).`);
            }
          });
        };

        let readerDone = false;
        while (!readerDone) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            readerDone = true;
            break;
          }

          resetTimeout();
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          events.forEach((evt) => {
            processEvent(evt);
          });
        }

        buffer = `${buffer}${decoder.decode()}`;
        if (buffer) {
          processEvent(buffer);
        }

        const finalContent = assistantContent.trim();
        if (!finalContent) {
          throw new Error('Gemini returned an empty response.');
        }

        updateAssistantMessage(finalContent);
        runAutoReplace(finalContent);
        return;
      }

      throw new Error('Unsupported service selected.');
    } catch (requestError) {
      console.error('[agent] request failed', requestError);
      setMessages((previousMessages) => {
        if (!previousMessages.length) {
          return previousMessages;
        }
        const nextMessages = [...previousMessages];
        const lastMessage = nextMessages[nextMessages.length - 1];
        if (lastMessage?.role === 'assistant' && !lastMessage.content) {
          nextMessages.pop();
        }
        return nextMessages;
      });
      if (requestError?.name === 'AbortError') {
        setError('Request timed out. The model may be overloaded or unresponsive.');
      } else {
        const fallbackError = isOllama
          ? 'Unable to contact Ollama. Please ensure the server is running and accessible.'
          : isOpenAi
            ? 'Unable to contact OpenAI. Please check your API key and network connection.'
            : isAnthropic
              ? 'Unable to contact Anthropic. Please check your API key and network connection.'
              : isGemini
                ? 'Unable to contact Gemini. Please check your API key and network connection.'
                : 'Unable to contact VRCH AI. Please check your API key and network connection.';
        setError(requestError?.message ?? fallbackError);
      }
    } finally {
      clearTimeout(timeoutId);
      setPending(false);
    }
  };

  // Apply is a pure "send code to editor" action — validation already ran
  // at stream end, so the user has seen any errors. Re-validating here would
  // block the user's deliberate decision to apply (or to ignore a soft warning).
  const handleApplyToEditor = () => {
    if (!lastSuggestionCode) {
      setError('The latest assistant response did not include a code block to apply.');
      return;
    }
    applyCodeAndWatch(lastSuggestionCode);
  };

  const handleRunCode = () => {
    context?.handleEvaluate?.();
  };

  const handleDeleteChat = () => {
    setError('');
    setMessages([]);
    lastAppliedSuggestionRef.current = '';
    selfCorrectionRetriesRef.current = 0;
    selfCorrectionLogBaselineRef.current = new Set();
    setSelfCorrectionActive(false);
  };

  const loadingIndicator = LOADING_INDICATOR_FRAMES[loadingIndicatorIndex] ?? LOADING_INDICATOR_FRAMES[0];
  const serviceName = SERVICE_LABELS[service] ?? 'Provider';
  const credentialLabel =
    service === SERVICE_TYPES.OLLAMA
      ? 'Ollama endpoint'
      : service === SERVICE_TYPES.OPENAI
        ? 'OpenAI API key'
        : service === SERVICE_TYPES.ANTHROPIC
          ? 'Anthropic API key'
          : service === SERVICE_TYPES.GEMINI
            ? 'Gemini API key'
            : 'VRCH API key';
  const credentialType = service === SERVICE_TYPES.OLLAMA ? 'text' : 'password';
  const credentialValue =
    service === SERVICE_TYPES.OLLAMA
      ? endpoint
      : service === SERVICE_TYPES.OPENAI
        ? openAiApiKey
        : service === SERVICE_TYPES.ANTHROPIC
          ? anthropicApiKey
          : service === SERVICE_TYPES.GEMINI
            ? geminiApiKey
            : vrchApiKey;
  const credentialPlaceholder =
    service === SERVICE_TYPES.OLLAMA
      ? DEFAULT_ENDPOINT
      : service === SERVICE_TYPES.OPENAI
        ? 'sk-...'
        : service === SERVICE_TYPES.ANTHROPIC
          ? 'sk-ant-...'
          : service === SERVICE_TYPES.GEMINI
            ? 'AIza...'
            : 'sk-...';
  const credentialAutoComplete = service === SERVICE_TYPES.OLLAMA ? 'url' : 'new-password';

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-4 p-4 text-foreground">
      {!isZen && (
        <div className="space-y-2 text-sm">
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
              Service
              <select
                className="rounded border border-lineBackground bg-background p-2 text-foreground"
                value={service}
                onChange={(event) => {
                  const nextService = event.target.value;
                  if (
                    nextService !== SERVICE_TYPES.OLLAMA &&
                    nextService !== SERVICE_TYPES.OPENAI &&
                    nextService !== SERVICE_TYPES.ANTHROPIC &&
                    nextService !== SERVICE_TYPES.GEMINI &&
                    nextService !== SERVICE_TYPES.VRCH
                  ) {
                    return;
                  }
                  if (nextService === service) {
                    return;
                  }
                  const savedModel = modelSelectionsRef.current[nextService] || '';
                  const compatibleModel =
                    nextService === SERVICE_TYPES.VRCH
                      ? normaliseVrchModel(savedModel)
                      : isServiceModelCompatible(nextService, savedModel)
                        ? savedModel
                        : '';
                  setService(nextService);
                  setError('');
                  setModelsError('');
                  setModelsLoading(false);
                  setAvailableModels(nextService === SERVICE_TYPES.OLLAMA && compatibleModel ? [compatibleModel] : []);
                  setModel(compatibleModel);
                }}
              >
                <option value={SERVICE_TYPES.OLLAMA}>Ollama</option>
                <option value={SERVICE_TYPES.OPENAI}>OpenAI</option>
                <option value={SERVICE_TYPES.ANTHROPIC}>Anthropic</option>
                <option value={SERVICE_TYPES.GEMINI}>Google Gemini</option>
                <option value={SERVICE_TYPES.VRCH}>Vrch AI</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
              Model
              <select
                className="rounded border border-lineBackground bg-background p-2 text-foreground"
                value={model || ''}
                onChange={(event) => setModel(event.target.value)}
                disabled={modelsLoading && modelOptions.length === 0}
              >
                <option value="" disabled hidden>
                  choose a model
                </option>
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {service === SERVICE_TYPES.VRCH ? getVrchModelLabel(option) : option}
                  </option>
                ))}
              </select>
              {modelsLoading && (
                <span className="text-[11px] normal-case tracking-normal text-foreground/60">Loading models…</span>
              )}
              {modelsError && !modelsLoading && (
                <span className="text-[11px] normal-case tracking-normal text-red-400">{modelsError}</span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
              {credentialLabel}
              <input
                className="rounded border border-lineBackground bg-background p-2 text-foreground"
                type={credentialType}
                value={credentialValue}
                onChange={(event) => {
                  if (service === SERVICE_TYPES.OLLAMA) {
                    setEndpoint(event.target.value);
                    return;
                  }
                  if (service === SERVICE_TYPES.OPENAI) {
                    setOpenAiApiKey(event.target.value);
                    return;
                  }
                  if (service === SERVICE_TYPES.ANTHROPIC) {
                    setAnthropicApiKey(event.target.value);
                    return;
                  }
                  if (service === SERVICE_TYPES.GEMINI) {
                    setGeminiApiKey(event.target.value);
                    return;
                  }
                  setVrchApiKey(event.target.value);
                }}
                placeholder={credentialPlaceholder}
                autoComplete={credentialAutoComplete}
              />
            </label>
          </div>
        </div>
      )}

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-auto rounded border border-lineBackground bg-background p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="space-y-2 text-foreground/70">
            <p>
              Chat with an AI coding agent powered by {serviceName} to generate or refine strudel patterns. Enable
              visual mode when you want Hydra visuals included with the music. The agent receives your current code so
              it can suggest targeted updates and respond with full strudel code you can apply directly.
            </p>
            {service === SERVICE_TYPES.OLLAMA ? (
              <p>
                Not able to connect your Ollama? Remember to allow CORS from{' '}
                <span className="underline">https://*.vibelive.club</span> in your Ollama service.{' '}
                <a href="https://www.google.com/search?q=how+to+enable+cors+in+ollama" target="_blank" rel="noreferrer">
                  <span className="underline">How?</span>
                </a>
              </p>
            ) : (
              <p>
                Your {serviceName} API key is saved in this browser and sent directly to {serviceName}. To reduce
                exposure risk, use a limited key, set spending limits, avoid shared browsers, remove the key when done,
                and install this page as an app/PWA for a cleaner standalone environment. Inspect the{' '}
                <a
                  className="underline"
                  href="https://github.com/VrchStudio/strudel-vibelive"
                  target="_blank"
                  rel="noreferrer"
                >
                  source code
                </a>{' '}
                if concerned.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-foreground/60">
                  {message.role === 'user' ? 'USER' : 'Agent'}
                </div>
                <div className="rounded bg-lineBackground/40 p-3">
                  {message.isLoading ? loadingIndicator : renderMessageContent(getDisplayContent(message))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="rounded border border-red-400 bg-red-500/10 p-2 text-xs">{error}</div>}

      {selfCorrectionActive && (
        <div className="rounded border border-yellow-400 bg-yellow-500/10 p-2 text-xs">
          Self-correcting...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
          {!isZen && <span>Prompt</span>}
          <textarea
            className="min-h-[64px] rounded border border-lineBackground bg-background p-2 text-foreground"
            placeholder="Describe your musical idea, visual idea, or ask for changes here"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="Prompt"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
          />
        </label>
        {!isZen && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded border border-lineForeground px-4 py-2 disabled:opacity-50"
              disabled={pending}
            >
              {pending ? 'thinking…' : 'send'}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApplyToEditor}
                className="rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
                disabled={!lastSuggestionCode}
              >
                apply
              </button>
              <label className="flex items-center gap-2 text-xs uppercase tracking-wide">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={autoReplaceEnabled}
                  onChange={(event) => setAutoReplaceEnabled(event.target.checked)}
                />
                <span className="normal-case text-foreground">auto</span>
              </label>
              <label className="flex items-center gap-2 text-xs uppercase tracking-wide">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={includeVisualsEnabled}
                  onChange={(event) => setIncludeVisualsEnabled(event.target.checked)}
                />
                <span className="normal-case text-foreground">visual (experimental)</span>
              </label>
            </div>
            <button
              type="button"
              onClick={handleDeleteChat}
              className="ml-auto rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
              disabled={messages.length === 0}
            >
              clear
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
