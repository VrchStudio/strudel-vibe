// vibe live coding experiment from vrch.ai

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { soundMap } from '@strudel/webaudio';
import { useSettings } from '../../../settings.mjs';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const SYSTEM_PROMPT = `You are Strudel's live coding assistant. Strudel is a JavaScript-based live coding environment for music.
- When you suggest code, respond with the full Strudel program code wrapped in a fenced code block labelled "strudel".
- Always follow the Strudel coding standards and use Strudel API, syntax, semantics and sounds provided in the system message.
- Always prefer concrete code over prose. 
- If the user asks for edits, update the existing code rather than starting from scratch unless explicitly requested.
- If the user asks for a new song, ignore the existing code and start from scratch.
- Prefer using simple code that you are sure will work. 
- Use sliders where you think fit for convenient live control.
- Make sure your music has enough variations and layered details. Always make some changes every 4 to 8 bars with smooth transitions. 
- When composite the final arranges, avoid putting any section longer than 16 bars.
- Try you best to make the music sounds great with good harmony.
- Offer very short and concise summary about your code.
- Avoid adding inline comment to your code.
- Avoid using Markdown syntax in your reply.
- Avoid thinking process. /no_think`;
const MODEL_KEEP_ALIVE = '5m';
const SERVICE_TYPES = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
};
const OPENAI_GPT5_PREFIX = /^gpt-5/i;

const STORAGE_KEYS = {
  model: 'strudel-agent:model',
  ollamaModel: 'strudel-agent:model:ollama',
  openaiModel: 'strudel-agent:model:openai',
  service: 'strudel-agent:service',
  endpoint: 'strudel-agent:endpoint',
  apiKey: 'strudel-agent:openai-api-key',
  messages: 'strudel-agent:messages',
  autoReplace: 'strudel-agent:auto-replace',
};

const MODEL_STORAGE_KEYS = {
  [SERVICE_TYPES.OLLAMA]: STORAGE_KEYS.ollamaModel,
  [SERVICE_TYPES.OPENAI]: STORAGE_KEYS.openaiModel,
};

const LOADING_INDICATOR_FRAMES = ['.', '..', '...'];
const LOADING_INDICATOR_INTERVAL = 400;
const PROMPT_WEBSOCKET_MAX_ITEMS = 5;
const PROMPT_WEBSOCKET_RECONNECT_DELAY = 2000;
const PROMPT_WEBSOCKET_URL_STORAGE_KEY = 'strudel-agent:prompt-ws-url';
const PROMPT_WEBSOCKET_HOST_STORAGE_KEY = 'strudel-agent:prompt-ws-host';
const PROMPT_WEBSOCKET_CHANNEL_STORAGE_KEY = 'strudel-agent:prompt-ws-channel';
const PROMPT_WEBSOCKET_PORT_STORAGE_KEY = 'strudel-agent:prompt-ws-port';
const DEFAULT_PROMPT_WEBSOCKET_PORT = 8001;
const DEFAULT_PROMPT_WEBSOCKET_CHANNEL = '1';

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

function normaliseEndpoint(value) {
  if (!value) {
    return DEFAULT_ENDPOINT;
  }
  return value.replace(/\/$/, '');
}

function getDisplayContent(message) {
  if (!message) {
    return '';
  }
  return message.displayContent ?? message.content;
}

function stripCodeBlocks(value) {
  if (!value) {
    return '';
  }
  return value.replace(/```[\s\S]*?```/g, '').trim();
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

  const formatLine = (label, values) =>
    values.length ? `${label}: ${values.join(', ')}` : `${label}: (none loaded)`;

  const lines = [
    formatLine('Samples', categories.samples),
    formatLine('Drum-machines', categories.drumMachines),
    formatLine('Synths', categories.synths),
    formatLine('Wavetables', categories.wavetables),
  ];

  return `${SOUND_PROMPT_HEADER}\n${lines.join('\n')}`;
}

export function AgentTab({ context }) {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [service, setService] = useState(SERVICE_TYPES.OLLAMA);
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [referenceDoc, setReferenceDoc] = useState('');
  const [autoReplaceEnabled, setAutoReplaceEnabled] = useState(false);
  const [loadingIndicatorIndex, setLoadingIndicatorIndex] = useState(0);
  const sounds = useStore(soundMap);
  const { isZen } = useSettings();
  const containerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [remotePrompts, setRemotePrompts] = useState([]);
  const remotePromptIdRef = useRef(0);
  const promptInputRef = useRef(null);
  const [promptWebsocketConfigVersion, setPromptWebsocketConfigVersion] = useState(0);
  const lastAppliedSuggestionRef = useRef('');
  const modelSelectionsRef = useRef({
    [SERVICE_TYPES.OLLAMA]: '',
    [SERVICE_TYPES.OPENAI]: '',
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
      const storedApiKey = window.localStorage.getItem(STORAGE_KEYS.apiKey);
      const storedMessages = window.localStorage.getItem(STORAGE_KEYS.messages);
      const storedAutoReplace = window.localStorage.getItem(STORAGE_KEYS.autoReplace);
      const storedOllamaModel = window.localStorage.getItem(STORAGE_KEYS.ollamaModel);
      const storedOpenAiModel = window.localStorage.getItem(STORAGE_KEYS.openaiModel);
      const legacyStoredModel = window.localStorage.getItem(STORAGE_KEYS.model);

      const initialService =
        storedService === SERVICE_TYPES.OLLAMA || storedService === SERVICE_TYPES.OPENAI
          ? storedService
          : SERVICE_TYPES.OLLAMA;

      const initialModelSelections = {
        [SERVICE_TYPES.OLLAMA]: storedOllamaModel || '',
        [SERVICE_TYPES.OPENAI]: storedOpenAiModel || '',
      };

      if (legacyStoredModel && !initialModelSelections[initialService]) {
        initialModelSelections[initialService] = legacyStoredModel;
      }

      modelSelectionsRef.current = initialModelSelections;

      if (initialService !== SERVICE_TYPES.OLLAMA) {
        setService(initialService);
      }

      const initialModel = initialModelSelections[initialService];
      if (initialModel) {
        setModel(initialModel);
        setAvailableModels((current) => (current.length === 0 ? [initialModel] : current));
      }

      if (storedEndpoint) {
        setEndpoint(storedEndpoint);
      }

      if (storedApiKey) {
        setApiKey(storedApiKey);
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

      if (storedAutoReplace === 'true') {
        setAutoReplaceEnabled(true);
      }
    } catch (storageError) {
      console.warn('[agent] unable to read saved settings', storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let websocket;
    let reconnectTimer = null;
    let cancelled = false;
    let hasLoggedError = false;
    let hasLoggedParseError = false;

    const readStorageValue = (key) => {
      try {
        return window.localStorage?.getItem(key) ?? '';
      } catch (storageError) {
        return '';
      }
    };

    const resolveWebSocketUrl = () => {
      const storedUrl = readStorageValue(PROMPT_WEBSOCKET_URL_STORAGE_KEY)?.trim();
      if (storedUrl) {
        return storedUrl;
      }

      const rawPort = readStorageValue(PROMPT_WEBSOCKET_PORT_STORAGE_KEY);
      const parsedPort = Number(rawPort);
      const port =
        Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PROMPT_WEBSOCKET_PORT;

      const storedChannel = readStorageValue(PROMPT_WEBSOCKET_CHANNEL_STORAGE_KEY)?.trim();
      const channel = storedChannel || DEFAULT_PROMPT_WEBSOCKET_CHANNEL;

      const storedHost = readStorageValue(PROMPT_WEBSOCKET_HOST_STORAGE_KEY)?.trim();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = storedHost || window.location.hostname || '127.0.0.1';

      return `${protocol}//${host}:${port}/json?channel=${encodeURIComponent(channel)}`;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer !== null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, PROMPT_WEBSOCKET_RECONNECT_DELAY);
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      const url = resolveWebSocketUrl();
      if (!url || !(url.startsWith('ws://') || url.startsWith('wss://'))) {
        return;
      }

      try {
        websocket = new WebSocket(url);
      } catch (connectionError) {
        if (!hasLoggedError) {
          console.warn('[agent] unable to open prompt websocket', connectionError);
          hasLoggedError = true;
        }
        scheduleReconnect();
        return;
      }

      websocket.onopen = () => {
        hasLoggedError = false;
        hasLoggedParseError = false;
      };

      websocket.onmessage = (event) => {
        if (cancelled) {
          return;
        }
        if (typeof event.data !== 'string') {
          return;
        }
        try {
          const payload = JSON.parse(event.data);
          const incomingPrompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
          if (!incomingPrompt) {
            return;
          }
          const nextId = remotePromptIdRef.current + 1;
          remotePromptIdRef.current = nextId;
          setRemotePrompts((previous) => {
            const nextItems = [...previous, { id: nextId, prompt: incomingPrompt }];
            if (nextItems.length > PROMPT_WEBSOCKET_MAX_ITEMS) {
              nextItems.splice(0, nextItems.length - PROMPT_WEBSOCKET_MAX_ITEMS);
            }
            return nextItems;
          });
        } catch (parseError) {
          if (!hasLoggedParseError) {
            console.warn('[agent] unable to parse prompt websocket payload', parseError);
            hasLoggedParseError = true;
          }
        }
      };

      websocket.onerror = (event) => {
        if (cancelled) {
          return;
        }
        if (!hasLoggedError) {
          console.warn('[agent] prompt websocket error', event);
          hasLoggedError = true;
        }
        try {
          websocket?.close();
        } catch (_error) {
          // ignore
        }
        scheduleReconnect();
      };

      websocket.onclose = () => {
        if (cancelled) {
          return;
        }
        websocket = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (websocket) {
        try {
          websocket.close();
        } catch (_error) {
          // ignore
        }
        websocket = null;
      }
    };
  }, [promptWebsocketConfigVersion]);

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
      if (apiKey) {
        window.localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.apiKey);
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist OpenAI API key', storageError);
    }
  }, [apiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (autoReplaceEnabled) {
        window.localStorage.setItem(STORAGE_KEYS.autoReplace, 'true');
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.autoReplace);
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist auto-replace preference', storageError);
    }
  }, [autoReplaceEnabled]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadReferenceDoc = async () => {
      if (typeof window === 'undefined') {
        return;
      }

      try {
        const response = await fetch('/docs.min.json', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Unable to load Strudel reference (status ${response.status})`);
        }
        const text = (await response.text())?.trim() ?? '';
        if (cancelled) {
          return;
        }
        if (!text) {
          setReferenceDoc('');
          return;
        }
        let serialised = text;
        try {
          serialised = JSON.stringify(JSON.parse(text));
        } catch (parseError) {
          console.warn('[agent] unable to parse Strudel reference JSON, using raw text', parseError);
        }
        setReferenceDoc(serialised);
      } catch (fetchError) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        console.warn('[agent] unable to load Strudel reference', fetchError);
      }
    };

    loadReferenceDoc();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (service === SERVICE_TYPES.OPENAI) {
      const trimmedApiKey = apiKey.trim();
      if (!trimmedApiKey) {
        setModelsLoading(false);
        setModelsError('Enter an OpenAI API key to load GPT-5 models.');
        setAvailableModels(model ? [model] : []);
        return;
      }

      let cancelled = false;
      const controller = new AbortController();

      const loadOpenAiModels = async () => {
        setModelsLoading(true);
        setModelsError('');
        try {
          const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${trimmedApiKey}`,
              Accept: 'application/json',
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            let message = text;
            try {
              message = JSON.parse(text)?.error?.message ?? text;
            } catch {
            }
            throw new Error(message || `Unable to fetch models (status ${response.status})`);
          }

          const payload = await response.json();
          const models = Array.isArray(payload?.data)
            ? payload.data
                .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
                .filter(
                  (id) => typeof id === 'string' && id && OPENAI_GPT5_PREFIX.test(id),
                )
            : [];

          if (cancelled) {
            return;
          }

          if (models.length === 0) {
            setModelsError('No GPT-5 models returned by OpenAI for this API key.');
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
        } catch (fetchError) {
          if (controller.signal.aborted || cancelled) {
            return;
          }
          console.error('[agent] unable to load OpenAI model list', fetchError);
          setModelsError(fetchError?.message ?? 'Unable to load models from OpenAI.');
        } finally {
          if (!cancelled) {
            setModelsLoading(false);
          }
        }
      };

      loadOpenAiModels();

      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    let cancelled = false;
    const controller = new AbortController();

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
          ? payload.models
              .map((entry) => entry?.model ?? entry?.name ?? '')
              .filter(Boolean)
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
  }, [service, endpoint, apiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const persistableMessages = messages.filter((message) => !message?.isLoading);
      window.localStorage.setItem(
        STORAGE_KEYS.messages,
        JSON.stringify(persistableMessages),
      );
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
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
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

      const isPeriodKey =
        event.code === 'Period'
        || event.key === '.'
        || event.key === '>';

      if (isPeriodKey && event.shiftKey) {
        event.preventDefault();
        setError('');
        setMessages([]);
        lastAppliedSuggestionRef.current = '';
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

  const runAutoReplace = useCallback(
    (assistantContent) => {
      if (!autoReplaceEnabled) {
        return;
      }
      const code = extractCodeFromMessage(assistantContent ?? '');
      if (!code) {
        return;
      }
      if (lastAppliedSuggestionRef.current === code) {
        return;
      }
      const editor = context?.editorRef?.current;
      if (!editor?.setCode) {
        return;
      }
      setError('');
      editor.setCode(code);
      lastAppliedSuggestionRef.current = code;
    },
    [autoReplaceEnabled, context],
  );

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
      setLoadingIndicatorIndex(
        (previous) => (previous + 1) % LOADING_INDICATOR_FRAMES.length,
      );
    }, LOADING_INDICATOR_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [messages]);

  const soundContextPrompt = useMemo(() => buildSoundContextPrompt(sounds), [sounds]);

  const modelOptions = useMemo(() => {
    const uniqueModels = Array.from(new Set((availableModels ?? []).filter(Boolean)));
    const trimmed = model.trim();
    if (trimmed && !uniqueModels.includes(trimmed)) {
      return [trimmed, ...uniqueModels];
    }
    return uniqueModels;
  }, [availableModels, model]);

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
    const trimmed = prompt.trim();
    if (!trimmed || pending) {
      return;
    }

    const isOllama = service === SERVICE_TYPES.OLLAMA;
    const serviceModels = availableModels;

    if (modelsLoading) {
      setError('Still loading available models. Please wait a moment.');
      return;
    }

    const selectedModel = model.trim();
    if (!selectedModel) {
      setError('Please choose a model before asking the agent.');
      return;
    }

    if (isOllama) {
      if (!serviceModels.length) {
        setError(
          modelsError
            || 'No Ollama models detected. Download a model in Ollama before chatting.',
        );
        return;
      }

      if (!serviceModels.includes(selectedModel)) {
        setError('The selected model is not available on the Ollama server. Please choose another model.');
        return;
      }
    } else {
      if (!apiKey.trim()) {
        setError('Please provide an OpenAI API key before asking the agent.');
        return;
      }

      if (!serviceModels.length) {
        setError(modelsError || 'No GPT-5 models available for this OpenAI API key.');
        return;
      }

      if (!serviceModels.includes(selectedModel)) {
        setError('The selected model is not available for OpenAI. Please choose another model.');
        return;
      }
    }

    setError('');
    setPending(true);
    setAutoScrollState(true);
    lastAppliedSuggestionRef.current = '';

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

    const conversationWithNewMessage = [...messages, userMessage];
    const sanitizedConversation = conversationWithNewMessage
      .map((message, index) => {
        const isLatestUserMessage =
          index === conversationWithNewMessage.length - 1 && message.role === 'user';
        if (isLatestUserMessage) {
          return { role: message.role, content: message.content };
        }
        const contentWithoutCode = stripCodeBlocks(message.content);
        if (!contentWithoutCode) {
          return null;
        }
        return { role: message.role, content: contentWithoutCode };
      })
      .filter(Boolean);

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

    try {
      const requestMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(referenceDoc
          ? [
              {
                role: 'system',
                content: `Strudel API reference (JSON). Each entry details Strudel functions and helpers. Use this to ensure your responses follow Strudel syntax and semantics.\n${referenceDoc}`,
              },
            ]
          : []),
        ...(soundContextPrompt ? [{ role: 'system', content: soundContextPrompt }] : []),
        ...sanitizedConversation.map(({ role, content }) => ({ role, content })),
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

      const trimmedApiKey = apiKey.trim();
      const openAiPayload = {
        model: selectedModel,
        stream: true,
        messages: requestMessages,
      };

      if (!OPENAI_GPT5_PREFIX.test(selectedModel)) {
        openAiPayload.temperature = 0.2;
      }

      // For dev to check final payload in browser console.
      console.log('[agent] openai request payload', openAiPayload);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedApiKey}`,
        },
        body: JSON.stringify(openAiPayload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      setAutoScrollState(true);

      if (!response.body) {
        const payload = await response.json();
        const assistantContent =
          payload?.choices?.[0]?.message?.content
          ?? payload?.choices?.[0]?.delta?.content
          ?? '';
        if (!assistantContent) {
          throw new Error('OpenAI returned an empty response.');
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
            console.warn('[agent] unable to parse OpenAI stream chunk', parseError, data);
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
        throw new Error('OpenAI returned an empty response.');
      }

      updateAssistantMessage(finalContent);
      runAutoReplace(finalContent);
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
      const fallbackError = isOllama
        ? 'Unable to contact Ollama. Please ensure the server is running and accessible.'
        : 'Unable to contact OpenAI. Please check your API key and network connection.';
      setError(requestError?.message ?? fallbackError);
    } finally {
      setPending(false);
    }
  };

  const handleRemotePromptClick = useCallback((value) => {
    if (typeof value !== 'string') {
      return;
    }

    const element = promptInputRef.current;
    const insertion = value;
    const hasCursor =
      element
      && document.activeElement === element
      && typeof element.selectionStart === 'number'
      && typeof element.selectionEnd === 'number';

    const selectionStart = hasCursor ? element.selectionStart : null;
    const selectionEnd = hasCursor ? element.selectionEnd : null;
    let nextCursorPosition = null;
    const ensureSpace = (text, index) => {
      if (!text) {
        return '';
      }
      if (index === 0) {
        return '';
      }
      const preceding = text[index - 1];
      if (!preceding || /\s/.test(preceding)) {
        return '';
      }
      return ' ';
    };

    setPrompt((previous = '') => {
      if (
        hasCursor
        && selectionStart !== null
        && selectionEnd !== null
        && selectionStart <= selectionEnd
      ) {
        const space = ensureSpace(previous, selectionStart);
        const before = previous.slice(0, selectionStart);
        const after = previous.slice(selectionEnd);
        nextCursorPosition = selectionStart + space.length + insertion.length;
        return `${before}${space}${insertion}${after}`;
      }
      const space = ensureSpace(previous, previous.length);
      nextCursorPosition = previous.length + space.length + insertion.length;
      return `${previous}${space}${insertion}`;
    });

    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      const currentElement = promptInputRef.current;
      if (!currentElement) {
        return;
      }
      try {
        if (typeof nextCursorPosition === 'number') {
          currentElement.setSelectionRange(nextCursorPosition, nextCursorPosition);
        }
      } catch (_error) {
        // ignore selection errors
      }
      try {
        currentElement.focus({ preventScroll: true });
      } catch (_error) {
        currentElement.focus();
      }
    });
  }, [setPrompt]);

  const handleResetPromptWebsocket = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.removeItem(PROMPT_WEBSOCKET_URL_STORAGE_KEY);
      window.localStorage.removeItem(PROMPT_WEBSOCKET_HOST_STORAGE_KEY);
      window.localStorage.removeItem(PROMPT_WEBSOCKET_PORT_STORAGE_KEY);
      window.localStorage.removeItem(PROMPT_WEBSOCKET_CHANNEL_STORAGE_KEY);
    } catch (_error) {
      // ignore storage errors
    }
    setRemotePrompts([]);
    setPromptWebsocketConfigVersion((value) => value + 1);
  }, []);

  const handleReplaceEditor = () => {
    if (!lastSuggestionCode) {
      setError('The latest assistant response did not include a code block to apply.');
      return;
    }
    setError('');
    context?.editorRef?.current?.setCode?.(lastSuggestionCode);
    lastAppliedSuggestionRef.current = lastSuggestionCode;
  };

  const handleAppendToEditor = () => {
    if (!lastSuggestionCode) {
      setError('The latest assistant response did not include a code block to apply.');
      return;
    }
    setError('');
    const editor = context?.editorRef?.current;
    if (!editor) {
      return;
    }
    const existing = editor.code ?? '';
    const separator = existing.trim() ? '\n\n' : '';
    editor.setCode?.(`${existing}${separator}${lastSuggestionCode}`);
    lastAppliedSuggestionRef.current = lastSuggestionCode;
  };

  const handleRunCode = () => {
    context?.handleEvaluate?.();
  };

  const handleDeleteChat = () => {
    setError('');
    setMessages([]);
    lastAppliedSuggestionRef.current = '';
  };

  const loadingIndicator =
    LOADING_INDICATOR_FRAMES[loadingIndicatorIndex] ?? LOADING_INDICATOR_FRAMES[0];

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
                    nextService !== SERVICE_TYPES.OLLAMA
                    && nextService !== SERVICE_TYPES.OPENAI
                  ) {
                    return;
                  }
                  if (nextService === service) {
                    return;
                  }
                  const savedModel = modelSelectionsRef.current[nextService] || '';
                  setService(nextService);
                  setError('');
                  setModelsError('');
                  setModelsLoading(false);
                  setAvailableModels(savedModel ? [savedModel] : []);
                  setModel(savedModel);
                }}
              >
                <option value={SERVICE_TYPES.OLLAMA}>Ollama</option>
                <option value={SERVICE_TYPES.OPENAI}>OpenAI</option>
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
                    {option}
                  </option>
                ))}
              </select>
              {modelsLoading && (
                <span className="text-[11px] normal-case tracking-normal text-foreground/60">
                  Loading models…
                </span>
              )}
              {modelsError && !modelsLoading && (
                <span className="text-[11px] normal-case tracking-normal text-red-400">
                  {modelsError}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
              {service === SERVICE_TYPES.OLLAMA ? 'Ollama endpoint' : 'OpenAI API key'}
              <input
                className="rounded border border-lineBackground bg-background p-2 text-foreground"
                type={service === SERVICE_TYPES.OLLAMA ? 'text' : 'password'}
                value={service === SERVICE_TYPES.OLLAMA ? endpoint : apiKey}
                onChange={(event) => {
                  if (service === SERVICE_TYPES.OLLAMA) {
                    setEndpoint(event.target.value);
                    return;
                  }
                  setApiKey(event.target.value);
                }}
                placeholder={service === SERVICE_TYPES.OLLAMA ? DEFAULT_ENDPOINT : 'sk-...'}
                autoComplete={service === SERVICE_TYPES.OLLAMA ? 'url' : 'new-password'}
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
              This is Vibe Live Club from Vrch未亓 - Live audiovisual powered by AI. Enjoy~
            </p>
            {service === SERVICE_TYPES.OLLAMA ? (
              <p>
                Not able to connect your Ollama? Remember to allow CORS from <span className="underline">https://*.vibelive.club</span> in your Ollama service.{' '}
                <a href="https://www.google.com/search?q=how+to+enable+cors+in+ollama" target="_blank" rel="noreferrer">
                  <span className="underline">How?</span>
                </a>
              </p>
            ) : (
              <p></p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-foreground/60">
                  {message.role === 'user' ? 'USER' : 'Agent'}
                </div>
                <div className="whitespace-pre-wrap rounded bg-lineBackground/40 p-3">
                  {message.isLoading ? loadingIndicator : getDisplayContent(message)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="rounded border border-red-400 bg-red-500/10 p-2 text-xs">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-foreground/60">
            <span>Audience Suggestions</span>
            <button
              type="button"
              className="rounded border border-lineBackground px-2 py-1 text-[10px] uppercase tracking-wide text-foreground transition hover:border-lineForeground"
              onClick={handleResetPromptWebsocket}
            >
              reset connection
            </button>
          </div>
          {remotePrompts.length === 0 ? (
            <p className="text-xs text-foreground/60">Waiting for prompts from VRCH sender…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {remotePrompts.map(({ id, prompt: remotePrompt }) => (
                <button
                  key={id}
                  type="button"
                  className="max-w-full rounded border border-lineBackground bg-lineBackground/40 px-3 py-2 text-left text-sm text-foreground transition hover:border-lineForeground hover:bg-lineBackground/60"
                  onClick={() => handleRemotePromptClick(remotePrompt)}
                  title={remotePrompt}
                >
                  <span className="block whitespace-pre-wrap break-words">{remotePrompt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
          {!isZen && <span>Prompt</span>}
          <textarea
            ref={promptInputRef}
            className="min-h-[64px] rounded border border-lineBackground bg-background p-2 text-foreground"
            placeholder="Describe your musical idea or ask for changes here"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="Prompt"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter'
                && !event.shiftKey
                && !event.isComposing
                && !event.ctrlKey
                && !event.metaKey
              ) {
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
              {pending ? 'thinking…' : 'ask agent'}
            </button>
            <button
              type="button"
              onClick={handleAppendToEditor}
              className="rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
              disabled={!lastSuggestionCode}
            >
              append
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReplaceEditor}
                className="rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
                disabled={!lastSuggestionCode}
              >
                replace
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
