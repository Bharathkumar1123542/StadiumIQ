import { type NextRequest, NextResponse } from 'next/server';
import {
  type ConciergeChatRequest,
  type ConciergeChatResponse,
  type AgentTurnResult,
  type LLMProvider,
  type RagSource,
  type ToolCall,
  type ToolName,
  type ModerationCategory,
  VENUES,
} from '@/types';

// ── Config ────────────────────────────────────────────────────────
const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL ?? 'http://localhost:8000';
const USE_MOCK         = process.env.USE_MOCK_AGENT === 'true' || !process.env.PYTHON_AGENT_URL;

// ── Mock RAG sources ──────────────────────────────────────────────
const MOCK_RAG_SOURCES: RagSource[] = [
  {
    documentId: 'doc_metlife_restrooms',
    title: 'MetLife Stadium — Restroom Locations Guide',
    excerpt: 'Level 2 restrooms are located adjacent to Gate C (north side) and Gate E (south side). Level 3 restrooms near section 312 are accessible from the main concourse ramp.',
    score: 0.921,
  },
  {
    documentId: 'doc_metlife_accessibility',
    title: 'Accessibility & ADA Compliance Manual 2026',
    excerpt: 'Wheelchair-accessible routes are marked with blue signage. Elevator banks at Gates A, C, and E serve all levels. Accessible restrooms available on every level.',
    score: 0.874,
  },
  {
    documentId: 'doc_ops_crowd_protocol',
    title: 'Crowd Management Protocol v3.1',
    excerpt: 'When zone density exceeds 3.5 p/m², the concierge should redirect fans to alternative routes. Gate C Level 2 serves as primary overflow for sections 310–320.',
    score: 0.812,
  },
];

// ── Mock tool call results ────────────────────────────────────────
const MOCK_TOOL_CALLS: ToolCall[] = [
  {
    toolName: 'crowd_density' as ToolName,
    args: { zoneId: 'zone_2', venueId: 'metlife' },
    result: { density: 4.2, heatBucket: 4, chokeProbability: 0.87 },
    latencyMs: 38,
  },
  {
    toolName: 'accessibility_route' as ToolName,
    args: { fromZone: 'zone_2', toZone: 'restroom_gate_c_l2', accessibility: true },
    result: {
      routeId: 'route_312_to_c2',
      steps: [
        { stepIndex: 0, instruction: 'Head toward Gate C ramp (follow blue signs)', landmark: 'Giant screen on right', floor: 3, distanceMetres: 45 },
        { stepIndex: 1, instruction: 'Take elevator or ramp down to Level 2', landmark: 'Elevator bank near concession stand', floor: 2, distanceMetres: 20 },
        { stepIndex: 2, instruction: 'Restrooms are 15m ahead on the left', landmark: 'Gate C restroom sign', floor: 2, distanceMetres: 15 },
      ],
      estimatedMinutes: 4,
      isAccessible: true,
      crowdLevel: 'low',
    },
    latencyMs: 55,
  },
];

// ── Multi-language demo responses ─────────────────────────────────
const DEMO_RESPONSES: Record<string, Record<string, string>> = {
  restroom: {
    pt: 'A seção 312 está muito cheia agora (4,2 pessoas/m²). Recomendo usar os banheiros do Portão C no Nível 2 — é o caminho mais acessível e menos lotado. São aproximadamente 4 minutos a pé. Siga as placas azuis ♿ a partir do corredor principal.',
    es: 'La sección 312 está muy concurrida ahora (4,2 personas/m²). Te recomiendo los baños de la Puerta C en el Nivel 2 — es la ruta más accesible y menos congestionada. Son aproximadamente 4 minutos caminando. Sigue los carteles azules ♿.',
    en: 'Section 312 is very busy right now (4.2 people/m²). I recommend the Gate C Level 2 restrooms — the most accessible and least congested route. It\'s about a 4-minute walk. Follow the blue ♿ signs from the main concourse.',
    fr: 'La section 312 est très fréquentée en ce moment (4,2 personnes/m²). Je vous recommande les toilettes du Niveau 2, Porte C — le trajet le plus accessible et le moins encombré. Environ 4 minutes à pied. Suivez les panneaux bleus ♿.',
    ar: 'القسم 312 مزدحم جداً الآن (4.2 شخص/م²). أنصحك باستخدام دورات المياه في البوابة C الطابق 2 — الطريق الأكثر إمكانية وأقل ازدحاماً. نحو 4 دقائق سيراً. اتبع اللافتات الزرقاء ♿.',
    ja: 'セクション312は現在非常に混雑しています（4.2人/m²）。ゲートC、レベル2のトイレをお勧めします — 最もバリアフリーで混雑が少ないルートです。徒歩約4分です。青い♿サインに従ってください。',
    zh: '312区现在非常拥挤（4.2人/m²）。建议您使用C门2层的洗手间——这是最无障碍、最不拥挤的路线。步行约4分钟。请跟随蓝色♿指示牌。',
    de: 'Abschnitt 312 ist gerade sehr voll (4,2 Personen/m²). Ich empfehle die Toiletten an Gate C, Ebene 2 — die zugänglichste und am wenigsten überfüllte Route. Etwa 4 Minuten zu Fuß. Folgen Sie den blauen ♿ Schildern.',
    ko: '312구역은 현재 매우 혼잡합니다(4.2명/m²). C게이트 2층 화장실을 추천합니다 — 가장 접근하기 쉽고 덜 혼잡한 경로입니다. 도보 약 4분입니다. 파란색 ♿ 표지판을 따라가세요.',
    hi: 'सेक्शन 312 अभी बहुत भीड़भाड़ वाला है (4.2 व्यक्ति/m²)। मैं गेट C, लेवल 2 के शौचालयों की सिफारिश करता हूं — सबसे सुलभ और कम भीड़ वाला मार्ग। लगभग 4 मिनट की पैदल दूरी है। नीले ♿ संकेतों का अनुसरण करें।',
  },
  accessibility: {
    en: 'All main gates (A, C, and E) have elevator access to every level. Wheelchair-accessible seating is available in sections 102, 204, and 318. If you need personal assistance, visit any blue-marked Info Kiosk and a volunteer will be dispatched within 5 minutes.',
    es: 'Todas las puertas principales (A, C y E) tienen acceso en ascensor a todos los niveles. Asientos accesibles para sillas de ruedas disponibles en secciones 102, 204 y 318.',
    pt: 'Todos os portões principais (A, C e E) têm acesso de elevador a todos os andares. Assentos acessíveis para cadeirantes disponíveis nas seções 102, 204 e 318.',
  },
  emergency: {
    en: 'I\'m escalating this to our medical team immediately. 🚨 Please stay where you are — a venue medic will reach you within 3 minutes. Your location has been flagged. If this is a life-threatening emergency, please call 911.',
    pt: 'Estou escalando isso para a nossa equipe médica imediatamente. 🚨 Por favor, fique onde está — um médico do local chegará até você em 3 minutos.',
    ar: 'سأحيل هذا الأمر فوراً إلى فريقنا الطبي. 🚨 الرجاء البقاء في مكانك — سيصل الطاقم الطبي خلال 3 دقائق.',
  },
};

// ── Simple language detection ─────────────────────────────────────
function detectLanguage(text: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/[\u0600-\u06FF]/, 'ar'],
    [/[\u3040-\u309F\u30A0-\u30FF]/, 'ja'],
    [/[\u4E00-\u9FFF]/, 'zh'],
    [/[\uAC00-\uD7AF]/, 'ko'],
    [/[\u0900-\u097F]/, 'hi'],
    [/\b(le|la|les|est|que|une|avec|dans|pour|sur)\b/i, 'fr'],
    [/\b(el|la|los|las|está|que|una|con|en|para|por)\b/i, 'es'],
    [/\b(de|das|die|der|ist|ein|mit|und|für|auf)\b/i, 'de'],
    [/\b(o|a|os|as|está|que|uma|com|em|para|por)\b/i, 'pt'],
  ];

  for (const [pattern, lang] of patterns) {
    if (pattern.test(text)) return lang;
  }
  return 'en';
}

// ── Moderation check ──────────────────────────────────────────────
const COMPETITOR_BRANDS = ['ticketmaster', 'stubhub', 'seatgeek', 'vivid seats', 'gametime'];

function moderateInput(text: string): ModerationCategory {
  const lower = text.toLowerCase();
  // PII patterns: SSN, credit card numbers
  if (/\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b/.test(text)) return 'pii_leakage';
  // Off-topic
  const offTopicTerms = ['bitcoin', 'crypto', 'stock', 'politics', 'election'];
  if (offTopicTerms.some(t => lower.includes(t))) return 'off_topic';
  // Competitor brands
  if (COMPETITOR_BRANDS.some(b => lower.includes(b))) return 'competitor_brand';
  return 'safe';
}

// ── Mock agent response ───────────────────────────────────────────
function buildMockResponse(
  message: string,
  detectedLang: string,
  accessibility: boolean,
): AgentTurnResult {
  const lower = message.toLowerCase();
  const lang = detectedLang;

  let responseText: string;
  let toolCalls: ToolCall[] = [];
  let ragSources: RagSource[] = [];

  const isEmergency = /urgent|medical|emergency|hurt|lost|sick|ajuda médica|emergencia|urgente|aide médicale|طوارئ|مساعدة|緊急|긴급|आपात/i.test(message);
  const isRestroom  = /restroom|bathroom|toilet|banheiro|baño|toilette|salle de bain|مرحاض|トイレ|화장실|शौचालय|wc\b/i.test(message);
  const isADA       = /wheelchair|accessible|disability|cadeira|silla de ruedas|fauteuil|wózek|車椅子|휠체어|व्हीलचेयर/i.test(message);

  if (isEmergency) {
    const responses = DEMO_RESPONSES.emergency;
    responseText = responses[lang] ?? responses['en'];
    toolCalls = [{
      toolName: 'emergency_escalate',
      args: { message, venueId: 'metlife', priority: 'high' },
      result: { ticketId: `esc_${Date.now()}`, dispatchedAt: new Date().toISOString() },
      latencyMs: 22,
    }];
    ragSources = [];
  } else if (isRestroom || accessibility || isADA) {
    const responses = DEMO_RESPONSES[isADA ? 'accessibility' : 'restroom'];
    responseText = responses[lang] ?? responses['en'];
    toolCalls = MOCK_TOOL_CALLS;
    ragSources = MOCK_RAG_SOURCES;
  } else {
    // Generic helpful response
    responseText = [
      lang === 'pt' && 'Posso ajudar com informações sobre o estádio. Tente perguntar sobre banheiros, acessibilidade, portões ou instalações.',
      lang === 'es' && 'Puedo ayudar con información del estadio. Pregúntame sobre baños, accesibilidad, puertas o instalaciones.',
      lang === 'ar' && 'يمكنني المساعدة بمعلومات عن الملعب. اسألني عن الحمامات أو إمكانية الوصول أو البوابات أو المرافق.',
      lang === 'fr' && 'Je peux aider avec des informations sur le stade. Demandez-moi les toilettes, l\'accessibilité, les portes ou les installations.',
      `I can help with stadium information. Ask me about restrooms, accessibility, gates, concessions, or emergency assistance.`,
    ].find(Boolean) as string;
    ragSources = MOCK_RAG_SOURCES.slice(0, 1);
    toolCalls  = [];
  }

  return {
    responseText,
    audioUrl: null,
    languageDetected: (detectedLang ?? 'en') as AgentTurnResult['languageDetected'],
    llmProvider: 'openai',
    ragSources,
    toolCallsMade: toolCalls,
    truncated: false,
    moderationCategory: 'safe',
    totalLatencyMs: 420 + Math.floor(Math.random() * 300),
    noRagContext: false,
  };
}

// ── Route handler ─────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse<ConciergeChatResponse>> {
  const start = Date.now();

  // Rate limiting header check (basic — production uses API gateway)
  const forwarded = req.headers.get('x-forwarded-for') ?? 'unknown';
  void forwarded; // in production: check Redis rate-limit bucket

  let body: ConciergeChatRequest;
  try {
    body = await req.json() as ConciergeChatRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Input validation
  if (!body.message?.trim() || !body.venueId || !body.sessionId) {
    return NextResponse.json(
      { success: false, error: 'message, venueId, and sessionId are required' },
      { status: 400 }
    );
  }

  if (body.message.length > 1000) {
    return NextResponse.json(
      { success: false, error: 'Message too long (max 1000 chars)' },
      { status: 400 }
    );
  }

  // Validate venueId against whitelist
  if (!VENUES.find(v => v.venueId === body.venueId)) {
    return NextResponse.json(
      { success: false, error: 'Unknown venueId' },
      { status: 400 }
    );
  }

  // Pre-moderation — short-circuit all unsafe categories before reaching LLM
  const modCategory = moderateInput(body.message);
  if (modCategory !== 'safe') {
    const MODERATION_RESPONSES: Record<string, string> = {
      pii_leakage: 'For your security, please don\'t share personal identification numbers in this chat. How else can I assist you?',
      off_topic: 'I\'m StadiumIQ, your venue assistant. I can help with restrooms, gates, accessibility, schedules, and emergency assistance. What do you need?',
      competitor_brand: 'I can only assist with official FIFA World Cup 2026 services. How can I help you at the venue today?',
    };
    return NextResponse.json({
      success: true,
      data: {
        responseText: MODERATION_RESPONSES[modCategory] ?? 'I can\'t help with that. Please visit an Info Kiosk.',
        audioUrl: null,
        languageDetected: 'en',
        llmProvider: 'fallback' as LLMProvider,
        ragSources: [],
        toolCallsMade: [],
        truncated: false,
        moderationCategory: modCategory,
        totalLatencyMs: Date.now() - start,
        noRagContext: false,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Detect language if auto
  const detectedLang = body.languageCode === 'auto'
    ? detectLanguage(body.message)
    : body.languageCode;

  // ── Try Python agent; fall back to mock ────────────────────────
  if (!USE_MOCK) {
    try {
      const agentRes = await fetch(`${PYTHON_AGENT_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, languageCode: detectedLang }),
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!agentRes.ok) {
        throw new Error(`Agent returned ${agentRes.status}`);
      }

      const agentData = await agentRes.json() as AgentTurnResult;
      return NextResponse.json(
        { success: true, data: agentData },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch (err) {
      console.error('[concierge] Python agent failed, using mock:', err);
      // Fall through to mock
    }
  }

  // ── Mock response (demo / fallback) ───────────────────────────
  const mockData = buildMockResponse(body.message, detectedLang, body.accessibility ?? false);
  mockData.totalLatencyMs = Date.now() - start;

  return NextResponse.json(
    { success: true, data: mockData },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
