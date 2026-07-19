import { type NextRequest, NextResponse } from 'next/server';
import {
  type EscalationTicket,
  type LanguageCode,
} from '@/types';

/**
 * In-memory escalation store — resets on server restart.
 * In production: PostgreSQL / Firestore with real-time listeners.
 * Privacy: ticket stores only trigger message text + session UUID, never fan identity.
 */
const store: EscalationTicket[] = [
  // Seed with 2 demo tickets so the dashboard has content on first load
  {
    ticketId: 'demo_ticket_001',
    sessionId: 'session_demo_a',
    venueId: 'metlife',
    zoneId: 'zone_2',
    languageCode: 'pt',
    triggerMessage: 'Preciso de ajuda médica urgente — minha filha está mal.',
    createdAt: Date.now() - 4 * 60_000,
    claimedBy: null,
    claimedAt: null,
    resolvedAt: null,
    status: 'open',
  },
  {
    ticketId: 'demo_ticket_002',
    sessionId: 'session_demo_b',
    venueId: 'metlife',
    zoneId: 'zone_5',
    languageCode: 'ar',
    triggerMessage: 'أحتاج مساعدة، فقدت طفلي في الملعب.',
    createdAt: Date.now() - 9 * 60_000,
    claimedBy: null,
    claimedAt: null,
    resolvedAt: null,
    status: 'open',
  },
];

// ── GET: list open tickets for a venue ───────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const venueId = searchParams.get('venue');

  const tickets = venueId
    ? store.filter(t => t.venueId === venueId)
    : store;

  return NextResponse.json(
    { tickets },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

// ── POST: create a new escalation ticket ─────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as {
      sessionId: string;
      venueId: string;
      zoneId: string | null;
      languageCode: LanguageCode;
      triggerMessage: string;
    };

    // Basic input validation
    if (!body.sessionId || !body.venueId || !body.triggerMessage) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Sanitize: truncate trigger message to 500 chars
    const ticket: EscalationTicket = {
      ticketId: `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: body.sessionId,
      venueId: body.venueId,
      zoneId: body.zoneId,
      languageCode: body.languageCode,
      triggerMessage: body.triggerMessage.slice(0, 500),
      createdAt: Date.now(),
      claimedBy: null,
      claimedAt: null,
      resolvedAt: null,
      status: 'open',
    };

    store.push(ticket);

    return NextResponse.json(
      { success: true, ticketId: ticket.ticketId },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
}
