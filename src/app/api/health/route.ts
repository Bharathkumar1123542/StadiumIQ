import { type NextRequest, NextResponse } from 'next/server';
import {
  type SystemHealthMetric,
  VENUES,
} from '@/types';

/**
 * System health endpoint — reports service status with realistic synthetic metrics.
 *
 * In a production system this reads from Prometheus/Datadog.
 * For the hackathon demo, we return synthetic but realistic metrics
 * that vary slightly each poll cycle to show "live" behaviour.
 *
 * The Python agent's real circuit-breaker state is fetched if
 * ``PYTHON_AGENT_URL`` is configured; otherwise the synthetic default is used.
 */

const PYTHON_AGENT_URL = process.env.PYTHON_AGENT_URL ?? 'http://localhost:8000';
const USE_MOCK = process.env.USE_MOCK_AGENT === 'true' || !process.env.PYTHON_AGENT_URL;

function buildHealthMetrics(venueId: string): SystemHealthMetric[] {
  const jitter = (range: number) => Math.floor(Math.random() * range);

  return [
    {
      service: 'concierge',
      status: 'ok',
      llmProvider: 'openai',
      p95LatencyMs: 680 + jitter(200),
      activeSessionCount: 1240 + jitter(80),
      circuitBreakerOpen: false,
      lastChecked: Date.now(),
    },
    {
      service: 'crowd_analytics',
      status: 'ok',
      llmProvider: 'gemini',
      p95LatencyMs: 42 + jitter(15),
      activeSessionCount: 48 + jitter(4),    // camera feeds
      circuitBreakerOpen: false,
      lastChecked: Date.now(),
    },
    {
      service: 'navigation',
      status: Math.random() > 0.9 ? 'degraded' : 'ok', // occasional degraded for demo
      llmProvider: 'openai',
      p95LatencyMs: 310 + jitter(90),
      activeSessionCount: 3400 + jitter(200),
      circuitBreakerOpen: false,
      lastChecked: Date.now(),
    },
  ] satisfies SystemHealthMetric[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const venueId = searchParams.get('venue') ?? VENUES[0].venueId;

  const metrics = buildHealthMetrics(venueId);

  // ── Try to fetch real circuit-breaker state from Python agent ──
  let agentHealth: Record<string, unknown> | null = null;
  if (!USE_MOCK) {
    try {
      const res = await fetch(`${PYTHON_AGENT_URL}/health`, {
        signal: AbortSignal.timeout(2_000), // fast probe — don't block dashboard
      });
      if (res.ok) {
        agentHealth = await res.json() as Record<string, unknown>;
        // Propagate real circuit-breaker state to the concierge metric
        const cbOpen = agentHealth?.circuit_breaker === 'open';
        const conciergeMetric = metrics.find(m => m.service === 'concierge');
        if (conciergeMetric) {
          conciergeMetric.circuitBreakerOpen = cbOpen;
          conciergeMetric.status = cbOpen ? 'degraded' : 'ok';
        }
      }
    } catch {
      // Agent health probe failed — use synthetic defaults; non-fatal
    }
  }

  return NextResponse.json(
    {
      metrics,
      agentHealth,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
