// vibe live coding experiment from vrch.ai

import { useEffect, useMemo, useState } from 'react';

const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_ENDPOINT = 'http://localhost:11434';
const SYSTEM_PROMPT = `You are Strudel's AI live coding assistant. Strudel is a JavaScript-based live coding environment for music.
- When you suggest code, respond with the full Strudel program wrapped in a fenced code block labelled "strudel".
- Offer concise guidance about how the changes affect the music.
- Prefer concrete code over prose and only use Strudel syntax.
- If the user asks for edits, update the existing code rather than starting from scratch unless explicitly requested.
- Keep you response short, precise and /no_think`;

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

export function AgentTab({ context }) {
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

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
      window.localStorage.setItem(STORAGE_KEYS.model, model);
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
            setModelsError('No models reported by Ollama.');
            setAvailableModels([DEFAULT_MODEL]);
            return;
          }
          const deduped = Array.from(new Set(models));
          setAvailableModels(deduped);
        }
      } catch (fetchError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        console.error('[agent] unable to load model list', fetchError);
        setModelsError(fetchError?.message ?? 'Unable to load models from Ollama.');
        if (!cancelled) {
          setAvailableModels((current) => (current.length ? current : [DEFAULT_MODEL]));
        }
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

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  );

  const lastSuggestionCode = useMemo(
    () => extractCodeFromMessage(latestAssistantMessage?.content ?? ''),
    [latestAssistantMessage],
  );

  const modelOptions = useMemo(() => {
    const baseOptions = availableModels.length ? availableModels : [DEFAULT_MODEL];
    const trimmed = model.trim();
    if (trimmed && !baseOptions.includes(trimmed)) {
      return [trimmed, ...baseOptions];
    }
    return baseOptions;
  }, [availableModels, model]);

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    const trimmed = prompt.trim();
    if (!trimmed || pending) {
      return;
    }

    setError('');
    setPending(true);

    const currentCode = context?.editorRef?.current?.code ?? context?.activeCode ?? '';
    const codeContext = currentCode
      ? `

Current Strudel code:

\`\`\`strudel
${currentCode}
\`\`\`
Please describe how your changes affect the music.`
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
      const response = await fetch(`${normaliseEndpoint(endpoint)}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.trim() || DEFAULT_MODEL,
          stream: false,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...conversation.map(({ role, content }) => ({ role, content })),
          ],
          options: {
            temperature: 0.2,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const assistantContent = payload?.message?.content || payload?.response || '';
      if (!assistantContent) {
        throw new Error('Ollama returned an empty response.');
      }

      const assistantMessage = {
        role: 'assistant',
        content: assistantContent.trim(),
      };

      setMessages([...conversation, assistantMessage]);
    } catch (requestError) {
      console.error('[agent] request failed', requestError);
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
    <div className="flex h-full flex-col gap-4 p-4 text-foreground">
      <div className="space-y-2 text-sm">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide">
            Model
            <select
              className="rounded border border-lineBackground bg-background p-2 text-foreground"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={modelsLoading && modelOptions.length === 0}
            >
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

      <div className="flex-1 overflow-auto rounded border border-lineBackground bg-background p-3 text-sm">
        {messages.length === 0 ? (
          <div className="text-foreground/70">
            Chat with an Ollama-powered coding agent to generate or refine strudel patterns. The agent receives your current code so it can suggest targeted updates, and respond with full strudel code you can apply directly.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-foreground/60">
                  {message.role === 'user' ? 'You' : 'Assistant'}
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
            className="min-h-[100px] rounded border border-lineBackground bg-background p-2 text-foreground"
            placeholder="Describe the musical idea or ask for changes"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
            disabled={pending}
          >
            {pending ? 'thinking…' : 'ask the agent'}
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
