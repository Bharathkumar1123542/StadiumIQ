'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  type ChatMessage,
  type AgentTurnResult,
  type LanguageCode,
  type RagSource,
  type ToolCall,
  LANGUAGES,
  VENUES,
} from '@/types';
import { ThinkingDots } from '@/components/shared/LoadingSpinner';
import { LLMProviderBadge, ModerationBadge } from '@/components/shared/StatusBadge';
import styles from './concierge.module.css';

// ── Demo hint prompts ─────────────────────────────────────────────
const DEMO_HINTS: Record<string, string[]> = {
  en: [
    'Where is the nearest restroom from Section 312?',
    'What gates are wheelchair accessible?',
    'When does the concession stand on Level 2 close?',
  ],
  es: [
    '¿Dónde está el baño más cercano de la sección 312?',
    '¿Qué puertas son accesibles para sillas de ruedas?',
  ],
  pt: [
    'Onde fica o banheiro mais próximo da seção 312?',
    'Quais portões são acessíveis para cadeirantes?',
  ],
  fr: [
    'Où se trouve la salle de bain la plus proche de la section 312?',
  ],
};

// ── Utility helpers ───────────────────────────────────────────────
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── RAG Sources accordion ─────────────────────────────────────────
function RagAccordion({ sources, msgId }: { sources: RagSource[]; msgId: string }) {
  const [open, setOpen] = useState(false);
  const listId = `rag-sources-${msgId}`;

  if (!sources.length) return null;

  return (
    <div className={styles.ragSection}>
      <button
        className={styles.ragToggle}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={listId}
      >
        <em className={`${styles.ragChevron} ${open ? styles['ragChevron--open'] : ''}`} aria-hidden="true">▶</em>
        {sources.length} context source{sources.length > 1 ? 's' : ''}
      </button>
      {open && (
        <ul id={listId} className={styles.ragSources} role="list">
          {sources.map(src => (
            <li key={src.documentId} className={styles.ragCard}>
              <span className={styles.ragTitle}>{src.title}</span>
              <span className={styles.ragExcerpt}>{src.excerpt}</span>
              <span className={styles.ragScore}>score {src.score.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tool call chips ───────────────────────────────────────────────
function ToolTrace({ calls }: { calls: ToolCall[] }) {
  if (!calls.length) return null;
  return (
    <div className={styles.toolTrace} aria-label="Agent tool calls">
      {calls.map((tc, i) => (
        <span key={i} className={`${styles.toolChip} ${tc.result ? styles['toolChip--ok'] : ''}`}>
          <span aria-hidden="true">⚙</span>
          {tc.toolName} ({tc.latencyMs}ms)
        </span>
      ))}
    </div>
  );
}

// ── Single message bubble ─────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage & { agentResult?: AgentTurnResult } }) {
  const isUser = msg.role === 'user';

  return (
    <div
      className={`${styles.messageRow} ${isUser ? styles['messageRow--user'] : ''}`}
      role="article"
      aria-label={`${isUser ? 'Fan' : 'StadiumIQ'} message`}
    >
      {/* Avatar */}
      <div
        className={`${styles.avatar} ${isUser ? styles['avatar--user'] : styles['avatar--assistant']}`}
        aria-hidden="true"
      >
        {isUser ? '🧑' : '🤖'}
      </div>

      {/* Bubble */}
      <div className={styles.bubble}>
        <div
          className={`${styles.bubbleContent} ${isUser ? styles['bubbleContent--user'] : styles['bubbleContent--assistant']}`}
          dir={LANGUAGES[msg.languageCode]?.rtl ? 'rtl' : 'ltr'}
          lang={msg.languageCode === 'auto' ? undefined : msg.languageCode}
        >
          {msg.isLoading ? (
            <div className={styles.loadingBubble}>
              <ThinkingDots />
            </div>
          ) : (
            msg.content
          )}
        </div>

        {/* Meta row */}
        {!msg.isLoading && (
          <div className={`${styles.bubbleMeta} ${isUser ? styles['bubbleMeta--user'] : ''}`}>
            <span className={styles.timestamp}>{formatTime(msg.timestamp)}</span>
            {msg.agentResult && (
              <>
                <LLMProviderBadge provider={msg.agentResult.llmProvider} />
                <ModerationBadge category={msg.agentResult.moderationCategory} />
              </>
            )}
          </div>
        )}

        {/* Tool trace */}
        {msg.agentResult?.toolCallsMade && (
          <ToolTrace calls={msg.agentResult.toolCallsMade} />
        )}

        {/* RAG sources */}
        {msg.agentResult?.ragSources && (
          <RagAccordion sources={msg.agentResult.ragSources} msgId={msg.id} />
        )}
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────
export default function ConciergePage() {
  const searchParams  = useSearchParams();
  const venueId       = searchParams.get('venue') ?? VENUES[0].venueId;
  const venueMeta     = VENUES.find(v => v.venueId === venueId) ?? VENUES[0];

  const [messages, setMessages]         = useState<(ChatMessage & { agentResult?: AgentTurnResult })[]>([]);
  const [input, setInput]               = useState('');
  const [language, setLanguage]         = useState<LanguageCode>('auto');
  const [accessibility, setAccessibility] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [degraded, setDegraded]         = useState(false);
  const [noRagWarn, setNoRagWarn]       = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      languageCode: language,
      timestamp: Date.now(),
    };

    const loadingMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      languageCode: language,
      timestamp: Date.now(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: typeof window !== 'undefined'
            ? (sessionStorage.getItem('siq_session') ?? (() => {
                const id = generateId();
                sessionStorage.setItem('siq_session', id);
                return id;
              })())
            : generateId(),
          venueId,
          message: trimmed,
          languageCode: language,
          accessibility,
          zoneId: null,
        }),
      });

      const json = await res.json();

      if (!json.success || !json.data) {
        throw new Error(json.error ?? 'Unknown error');
      }

      const result: AgentTurnResult = json.data;

      // Surface warning if RAG was unavailable
      if (result.noRagContext) setNoRagWarn(true);

      const assistantMsg: ChatMessage & { agentResult: AgentTurnResult } = {
        id: generateId(),
        role: 'assistant',
        content: result.responseText,
        languageCode: result.languageDetected,
        timestamp: Date.now(),
        agentResult: result,
      };

      setMessages(prev => [
        ...prev.filter(m => !m.isLoading),
        assistantMsg,
      ]);
    } catch {
      // Graceful degradation: show cached/error response
      setDegraded(true);
      const fallback: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '⚠ StadiumIQ is temporarily limited. Please visit a nearby information kiosk or ask a volunteer for assistance.',
        languageCode: 'en',
        timestamp: Date.now(),
      };
      setMessages(prev => [
        ...prev.filter(m => !m.isLoading),
        fallback,
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, language, venueId, accessibility]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const hints = DEMO_HINTS[language] ?? DEMO_HINTS['en'];

  return (
    <div className={styles.page}>
      {/* ── Degraded mode banner ─────────────── */}
      {degraded && (
        <div className={styles.degradedBanner} role="alert" aria-live="assertive">
          ⚠ AI service degraded — responses may be limited. Kiosks available at all main gates.
        </div>
      )}

      {/* ── No-RAG warning ───────────────────── */}
      {noRagWarn && !degraded && (
        <div className={styles.degradedBanner} role="status" aria-live="polite">
          ℹ Venue knowledge base temporarily offline — answers may be less specific.
        </div>
      )}

      {/* ── Header ──────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>
            <span aria-hidden="true">🎙</span>
            Fan Concierge
          </h1>
          <p className={styles.headerSub}>
            {venueMeta.name} · {venueMeta.city} · {venueMeta.capacity.toLocaleString()} cap.
          </p>
        </div>

        <div className={styles.headerRight}>
          {/* Language selector */}
          <label htmlFor="lang-select" className="sr-only">Response language</label>
          <select
            id="lang-select"
            className={styles.langSelect}
            value={language}
            onChange={e => setLanguage(e.target.value as LanguageCode)}
            aria-label="Select response language"
          >
            <option value="auto">🌐 Auto-detect</option>
            {Object.values(LANGUAGES).map(l => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.nativeName}
              </option>
            ))}
          </select>

          {/* Accessibility toggle */}
          <button
            id="accessibility-toggle"
            className={`btn btn--sm ${accessibility ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setAccessibility(a => !a)}
            aria-pressed={accessibility}
            title={accessibility ? 'Accessibility routes: ON' : 'Accessibility routes: OFF'}
          >
            ♿ {accessibility ? 'Accessible' : 'Accessible?'}
          </button>
        </div>
      </header>

      {/* ── Chat messages ────────────────────── */}
      <div
        className={styles.chatWrapper}
        role="log"
        aria-live="polite"
        aria-label="Chat conversation"
        aria-atomic="false"
      >
        {messages.length === 0 ? (
          <div className={styles.welcome} aria-label="Chat welcome state">
            <span className={styles.welcomeIcon} aria-hidden="true">🎙</span>
            <p className={styles.welcomeTitle}>
              Ask anything about {venueMeta.name}
            </p>
            <div className={styles.welcomeHints}>
              {hints.map(hint => (
                <button
                  key={hint}
                  className={styles.hintChip}
                  onClick={() => sendMessage(hint)}
                  aria-label={`Demo question: ${hint}`}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      {/* ── Input bar ───────────────────────── */}
      <div className={styles.inputBar}>
        <div className={styles.inputRow}>
          <label htmlFor="chat-input" className="sr-only">
            Type your question in any language
          </label>
          <textarea
            ref={textareaRef}
            id="chat-input"
            className={styles.textarea}
            placeholder="Ask in any language — try Portuguese, Arabic, Japanese…"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Chat input — press Enter to send, Shift+Enter for new line"
            disabled={loading}
            maxLength={1000}
          />

          {/* Send button */}
          <button
            id="send-btn"
            className={styles.sendBtn}
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            aria-label="Send message"
            title="Send (Enter)"
          >
            {loading ? '⏳' : '➤'}
          </button>
        </div>
        <p className={styles.inputHint}>
          Enter to send · Shift+Enter for newline · No fan data stored
        </p>
      </div>
    </div>
  );
}
