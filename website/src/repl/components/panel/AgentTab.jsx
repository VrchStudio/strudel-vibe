// vibe live coding experiment from vrch.ai

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { soundMap } from '@strudel/webaudio';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const SYSTEM_PROMPT = `You are Strudel's AI live coding assistant. Strudel is a JavaScript-based live coding environment for music.
- When you suggest code, respond with the full Strudel program wrapped in a fenced code block labelled "strudel".
- Only use Strudel API, syntax, semantics and sounds provided in the system message.
- Always prefer concrete code over prose. 
- Offer very short and concise summary about your code.
- If the user asks for edits, update the existing code rather than starting from scratch unless explicitly requested.
- If the user asks for a new pattern, ignore the existing code and start from scratch.
- Avoid adding comment to your code.
- Avoid using Markdown syntax in your reply.
- Avoid thinking process. /no_think`;
const MODEL_KEEP_ALIVE = '5m';

const STORAGE_KEYS = {
  model: 'strudel-agent:model',
  endpoint: 'strudel-agent:endpoint',
  messages: 'strudel-agent:messages',
};

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
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [referenceDoc, setReferenceDoc] = useState('');
  const sounds = useStore(soundMap);
  const containerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

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
      const storedModel = window.localStorage.getItem(STORAGE_KEYS.model);
      const storedEndpoint = window.localStorage.getItem(STORAGE_KEYS.endpoint);
      const storedMessages = window.localStorage.getItem(STORAGE_KEYS.messages);

      if (storedModel) {
        setModel(storedModel);
      }

      if (storedEndpoint) {
        setEndpoint(storedEndpoint);
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
    } catch (storageError) {
      console.warn('[agent] unable to read saved settings', storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (model) {
        window.localStorage.setItem(STORAGE_KEYS.model, model);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.model);
      }
    } catch (storageError) {
      console.warn('[agent] unable to persist model', storageError);
    }
  }, [model]);

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
    let cancelled = false;
    const controller = new AbortController();

    const loadModels = async () => {
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
            return;
          }
          const deduped = Array.from(new Set(models));
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

    loadModels();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages));
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
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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
      setAutoScrollState(nearBottom);
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

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        context?.handleEvaluate?.();
        return;
      }

      if (event.key === '.' && !event.shiftKey) {
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

      nextMessages[lastIndex] = {
        ...lastMessage,
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

    if (modelsLoading) {
      setError('Still loading available models. Please wait a moment.');
      return;
    }

    const selectedModel = model.trim();
    if (!selectedModel) {
      setError('Please choose a model before asking the agent.');
      return;
    }

    if (!availableModels.length) {
      setError(
        modelsError
          || 'No Ollama models detected. Download a model in Ollama before chatting.',
      );
      return;
    }

    if (!availableModels.includes(selectedModel)) {
      setError('The selected model is not available on the Ollama server. Please choose another model.');
      return;
    }

    setError('');
    setPending(true);
    setAutoScrollState(true);

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

    setMessages(conversation);
    setPrompt('');

    try {
      const targetEndpoint = normaliseEndpoint(endpoint);
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
        ...conversation.map(({ role, content }) => ({ role, content })),
      ];

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
      setMessages((previousMessages) => [
        ...previousMessages,
        {
          role: 'assistant',
          content: '',
          displayContent: '',
        },
      ]);

      if (!response.body) {
        const payload = await response.json();
        const assistantContent = payload?.message?.content || payload?.response || '';
        if (!assistantContent) {
          throw new Error('Ollama returned an empty response.');
        }
        updateAssistantMessage(assistantContent.trim());
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
      setError(
        requestError?.message
          ?? 'Unable to contact Ollama. Please ensure the server is running and accessible.',
      );
    } finally {
      setPending(false);
    }
  };

  const handleReplaceEditor = () => {
    if (!lastSuggestionCode) {
      setError('The latest assistant response did not include a code block to apply.');
      return;
    }
    setError('');
    context?.editorRef?.current?.setCode?.(lastSuggestionCode);
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
  };

  const handleRunCode = () => {
    context?.handleEvaluate?.();
  };

  const handleDeleteChat = () => {
    setError('');
    setMessages([]);
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col gap-4 p-4 text-foreground">
      <div className="space-y-2 text-sm">
        <div className="grid gap-2 md:grid-cols-2">
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
            Ollama endpoint
            <input
              className="rounded border border-lineBackground bg-background p-2 text-foreground"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={DEFAULT_ENDPOINT}
            />
          </label>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-auto rounded border border-lineBackground bg-background p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="text-foreground/70">
            Chat with an Ollama-powered coding agent to generate or refine strudel patterns. The agent receives your current code so it can suggest targeted updates, and respond with full strudel code you can apply directly.
            <br></br><br></br>
            Not able to connect your Ollama? Remember to allow CORS from <span className="underline">https://*.vibelive.club</span> in your Ollama service. <a href="https://www.google.com/search?q=how+to+enable+cors+in+ollama" target="_blank"><span className="underline">How?</span></a>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-foreground/60">
                  {message.role === 'user' ? 'You' : 'Agent'}
                </div>
                <div className="whitespace-pre-wrap rounded bg-lineBackground/40 p-3">
                  {getDisplayContent(message)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="rounded border border-red-400 bg-red-500/10 p-2 text-xs">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-2">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
          Prompt
          <textarea
            className="min-h-[64px] rounded border border-lineBackground bg-background p-2 text-foreground"
            placeholder="Describe your musical idea or ask for changes here"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
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
        <div></div>
        <div className="flex flex-wrap gap-2">
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
          <button
            type="button"
            onClick={handleReplaceEditor}
            className="rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
            disabled={!lastSuggestionCode}
          >
            replace
          </button>
          <button
            type="button"
            onClick={handleDeleteChat}
            className="rounded border border-lineBackground px-4 py-2 disabled:opacity-50"
            disabled={messages.length === 0}
          >
            clear
          </button>
        </div>
      </form>
    </div>
  );
}
