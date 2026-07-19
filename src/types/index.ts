/**
 * StadiumIQ — Shared TypeScript Types
 * Mirrors the data contracts defined in context.md and implementation.md
 */

// ── Enumerations ─────────────────────────────────────────────

export type AppView = 'home' | 'concierge' | 'dashboard';

/** BCP-47 language codes supported natively (10 full + DeepL fallback) */
export type LanguageCode =
  | 'en' | 'es' | 'fr' | 'pt' | 'ar'
  | 'de' | 'ja' | 'ko' | 'zh' | 'hi'
  | 'auto'; // Whisper auto-detect

export type AlertSeverity = 1 | 2 | 3; // Advisory / Warning / Critical

export type ModerationCategory =
  | 'safe'
  | 'pii_leakage'
  | 'off_topic'
  | 'competitor_brand';

export type LLMProvider = 'openai' | 'gemini' | 'fallback';

export type ToolName =
  | 'venue_search'
  | 'schedule_lookup'
  | 'accessibility_route'
  | 'emergency_escalate'
  | 'crowd_density';

// ── Fan / Session ────────────────────────────────────────────

export interface FanSession {
  sessionId: string;
  venueId: string;
  languageCode: LanguageCode;
  accessibility: boolean;
  /** Zone or section from ticket, e.g. "section_312" */
  zoneId: string | null;
  lastTurnTruncated: boolean;
}

// ── Concierge / Agent ────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  languageCode: LanguageCode;
  timestamp: number;
  audioUrl?: string | null;
  isVoice?: boolean;
  isLoading?: boolean;
}

export interface RagSource {
  documentId: string;
  title: string;
  excerpt: string;
  score: number; // 0–1 cosine similarity
}

export interface ToolCall {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
  latencyMs: number;
}

export interface AgentTurnResult {
  responseText: string;
  audioUrl: string | null;
  languageDetected: LanguageCode;
  llmProvider: LLMProvider;
  ragSources: RagSource[];
  toolCallsMade: ToolCall[];
  truncated: boolean;
  moderationCategory: ModerationCategory;
  totalLatencyMs: number;
  /** True if RAG was unavailable for this turn */
  noRagContext?: boolean;
}

// ── Crowd Analytics ──────────────────────────────────────────

/** Density in persons per m² */
export type DensityValue = number | null; // null = camera down / grey cell

export interface CrowdCell {
  cellId: string;
  zoneId: string;
  zoneName: string;
  density: DensityValue;
  /** 0–5 heat intensity bucket, or 'null' for downed camera */
  heatBucket: 0 | 1 | 2 | 3 | 4 | 5 | 'null';
  chokeProbability: number | null; // LSTM 5-min forecast, 0–1
  cameraOnline: boolean;
}

export interface CrowdGrid {
  venueId: string;
  timestamp: number;
  staleSince: number | null;
  cells: CrowdCell[][];  // rows × cols grid
  nullCellCount: number;
  /** True if > 30% cameras are down */
  degradedMode: boolean;
}

// ── Crowd Alert ──────────────────────────────────────────────

export interface CrowdAlert {
  alertId: string;
  venueId: string;
  zoneId: string;
  zoneName: string;
  severity: AlertSeverity;
  chokeProbability: number;
  currentDensity: number;
  triggeredAt: number;
  /** Whether the alert was pushed to fans via FCM/APNs */
  fanPushSent: boolean;
  /** Whether AR forced-reroute was activated (severity 3 only) */
  arRerouteActive: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
}

// ── Operations Dashboard ─────────────────────────────────────

export interface EscalationTicket {
  ticketId: string;
  sessionId: string;
  venueId: string;
  zoneId: string | null;
  languageCode: LanguageCode;
  /** The fan's message that triggered the escalation */
  triggerMessage: string;
  createdAt: number;
  /** Staff member who claimed the ticket */
  claimedBy: string | null;
  claimedAt: number | null;
  resolvedAt: number | null;
  status: 'open' | 'claimed' | 'resolved';
}

export interface SystemHealthMetric {
  service: 'concierge' | 'navigation' | 'crowd_analytics';
  status: 'ok' | 'degraded' | 'down';
  llmProvider: LLMProvider;
  p95LatencyMs: number;
  activeSessionCount: number;
  circuitBreakerOpen: boolean;
  lastChecked: number;
}

export interface VenueStats {
  venueId: string;
  venueName: string;
  city: string;
  capacity: number;
  activeSessionCount: number;
  alertsActive: AlertSeverity | null; // highest active severity
  conciergeQueriesLastHour: number;
  topLanguages: Array<{ code: LanguageCode; count: number }>;
}

// ── Navigation ───────────────────────────────────────────────

export interface FanPosition {
  x: number;
  y: number;
  floor: number;
  /** Accuracy radius in metres */
  accuracy: number | null;
  /** How position was determined */
  method: 'trilateration' | 'dead_reckoning' | 'frozen' | 'gps_mock';
  beaconsVisible: number;
}

export interface AccessibilityRoute {
  routeId: string;
  fromZone: string;
  toZone: string;
  steps: RouteStep[];
  estimatedMinutes: number;
  isAccessible: boolean;
  crowdLevel: 'low' | 'moderate' | 'high';
}

export interface RouteStep {
  stepIndex: number;
  instruction: string;
  landmark: string | null;
  floor: number;
  distanceMetres: number;
}

// ── Language metadata ────────────────────────────────────────

export interface LanguageMeta {
  code: LanguageCode;
  nativeName: string;
  englishName: string;
  flag: string;
  rtl: boolean;
}

export const LANGUAGES: Record<string, LanguageMeta> = {
  en: { code: 'en', nativeName: 'English',   englishName: 'English',    flag: '🇬🇧', rtl: false },
  es: { code: 'es', nativeName: 'Español',   englishName: 'Spanish',    flag: '🇪🇸', rtl: false },
  fr: { code: 'fr', nativeName: 'Français',  englishName: 'French',     flag: '🇫🇷', rtl: false },
  pt: { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', flag: '🇧🇷', rtl: false },
  ar: { code: 'ar', nativeName: 'العربية',   englishName: 'Arabic',     flag: '🇸🇦', rtl: true  },
  de: { code: 'de', nativeName: 'Deutsch',   englishName: 'German',     flag: '🇩🇪', rtl: false },
  ja: { code: 'ja', nativeName: '日本語',     englishName: 'Japanese',   flag: '🇯🇵', rtl: false },
  ko: { code: 'ko', nativeName: '한국어',     englishName: 'Korean',     flag: '🇰🇷', rtl: false },
  zh: { code: 'zh', nativeName: '中文',       englishName: 'Mandarin',   flag: '🇨🇳', rtl: false },
  hi: { code: 'hi', nativeName: 'हिन्दी',    englishName: 'Hindi',      flag: '🇮🇳', rtl: false },
};

// ── Venue data ───────────────────────────────────────────────

export interface VenueMeta {
  venueId: string;
  name: string;
  city: string;
  country: string;
  capacity: number;
  floors: number;
}

export const VENUES: VenueMeta[] = [
  { venueId: 'metlife',    name: 'MetLife Stadium',        city: 'East Rutherford', country: 'US', capacity: 82500, floors: 4 },
  { venueId: 'sofi',       name: 'SoFi Stadium',           city: 'Los Angeles',     country: 'US', capacity: 70240, floors: 3 },
  { venueId: 'atandt',     name: "AT&T Stadium",           city: 'Arlington',       country: 'US', capacity: 80000, floors: 4 },
  { venueId: 'azteca',     name: 'Estadio Azteca',         city: 'Mexico City',     country: 'MX', capacity: 87500, floors: 3 },
  { venueId: 'bcplace',    name: 'BC Place',               city: 'Vancouver',       country: 'CA', capacity: 54500, floors: 3 },
];

// ── API mock contract ────────────────────────────────────────

export interface ConciergeChatRequest {
  sessionId: string;
  venueId: string;
  message: string;
  languageCode: LanguageCode;
  accessibility: boolean;
  zoneId: string | null;
}

export interface ConciergeChatResponse {
  success: boolean;
  data?: AgentTurnResult;
  error?: string;
}
