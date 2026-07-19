import { type NextRequest, NextResponse } from 'next/server';
import {
  type CrowdGrid,
  type CrowdCell,
  type CrowdAlert,
  type AlertSeverity,
  VENUES,
} from '@/types';

// ── Synthetic LSTM-sim crowd generator ───────────────────────────
// Uses a seeded deterministic noise walk so values are reproducible
// per venue + minute bucket, then adds time-varying drift.

const GRID_ROWS = 8;
const GRID_COLS = 12;
const CHOKE_THRESHOLD = 0.75; // probability above which alert fires

/** Simple LCG pseudo-random, deterministic per seed */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Map density (p/m²) to heat bucket */
function densityToBucket(d: number): CrowdCell['heatBucket'] {
  if (d < 0.5) return 0;
  if (d < 1.0) return 1;
  if (d < 2.0) return 2;
  if (d < 3.0) return 3;
  if (d < 4.0) return 4;
  return 5;
}

const ZONE_NAMES = [
  'North Concourse', 'Gate A', 'Gate B', 'Gate C',
  'Gate D', 'South Stand', 'East Wing', 'West Wing',
  'Level 2 North', 'Level 2 South', 'VIP Entrance', 'Media Zone',
];

function minuteBucket() {
  return Math.floor(Date.now() / 60_000);
}

function buildGrid(venueId: string): CrowdGrid {
  // Seed changes per minute so the grid animates every poll cycle
  const seed = venueId.split('').reduce((acc, c) => acc + c.charCodeAt(0), minuteBucket());
  const rand = lcg(seed);

  // Camera downtime: ~8% of cells are offline
  const downCells = new Set<number>();
  const totalCells = GRID_ROWS * GRID_COLS;
  for (let i = 0; i < Math.floor(totalCells * 0.08); i++) {
    downCells.add(Math.floor(rand() * totalCells));
  }

  const cells: CrowdCell[][] = [];
  let nullCellCount = 0;

  for (let row = 0; row < GRID_ROWS; row++) {
    const rowCells: CrowdCell[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      const idx = row * GRID_COLS + col;
      const zoneIdx = (row + col) % ZONE_NAMES.length;
      const cameraOnline = !downCells.has(idx);

      if (!cameraOnline) {
        nullCellCount++;
        rowCells.push({
          cellId: `${row}_${col}`,
          zoneId: `zone_${zoneIdx}`,
          zoneName: ZONE_NAMES[zoneIdx],
          density: null,
          heatBucket: 'null',
          chokeProbability: null,
          cameraOnline: false,
        });
        continue;
      }

      // Base density 0–5 p/m², biased toward 1–2 for realism
      const base   = rand() * 5;
      const bias   = rand() * 1.5;  // adds congestion clusters
      const density = Math.min(6, base * 0.6 + bias);

      // Choke probability: sigmoid on density
      const chokeProbability = 1 / (1 + Math.exp(-2.5 * (density - 3.5)));

      rowCells.push({
        cellId: `${row}_${col}`,
        zoneId: `zone_${zoneIdx}`,
        zoneName: ZONE_NAMES[zoneIdx],
        density: parseFloat(density.toFixed(2)),
        heatBucket: densityToBucket(density),
        chokeProbability: parseFloat(chokeProbability.toFixed(3)),
        cameraOnline: true,
      });
    }
    cells.push(rowCells);
  }

  return {
    venueId,
    timestamp: Date.now(),
    staleSince: null,
    cells,
    nullCellCount,
    degradedMode: nullCellCount > totalCells * 0.3,
  };
}

function buildAlerts(grid: CrowdGrid): (CrowdAlert & { aiBrief?: string })[] {
  const alerts: (CrowdAlert & { aiBrief?: string })[] = [];
  const seen = new Set<string>();

  for (const row of grid.cells) {
    for (const cell of row) {
      if (
        cell.cameraOnline &&
        cell.chokeProbability !== null &&
        cell.chokeProbability > CHOKE_THRESHOLD &&
        cell.density !== null &&
        !seen.has(cell.zoneId)
      ) {
        seen.add(cell.zoneId);
        const prob = cell.chokeProbability;
        const severity: AlertSeverity =
          prob > 0.92 ? 3 :
          prob > 0.80 ? 2 : 1;

        // AI brief — in production this is a real GPT-4o call via /api/situation-brief
        // Here we template it deterministically for the demo
        const briefs: Record<AlertSeverity, string> = {
          3: `Extreme density in ${cell.zoneName} at ${cell.density!.toFixed(1)} p/m². Deploy stewards to Gate corridor immediately and activate overflow route via Level 2 east passage.`,
          2: `${cell.zoneName} approaching critical threshold (${(prob * 100).toFixed(0)}% choke probability). Recommend pre-positioning 2 stewards and monitoring for 5 minutes before forced reroute.`,
          1: `Early-stage congestion forming in ${cell.zoneName}. Passive wayfinding push recommended — no immediate staff deployment required.`,
        };

        alerts.push({
          alertId: `alert_${cell.cellId}_${minuteBucket()}`,
          venueId: grid.venueId,
          zoneId: cell.zoneId,
          zoneName: cell.zoneName,
          severity,
          chokeProbability: prob,
          currentDensity: cell.density!,
          triggeredAt: Date.now() - Math.floor(Math.random() * 120_000),
          fanPushSent: severity >= 2,
          arRerouteActive: severity === 3,
          acknowledgedBy: null,
          acknowledgedAt: null,
          aiBrief: briefs[severity],
        });
      }
    }
  }

  return alerts.sort((a, b) => b.severity - a.severity).slice(0, 6);
}


// ── Route handler ─────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const venueId = searchParams.get('venue') ?? VENUES[0].venueId;
  const panel   = searchParams.get('panel');

  const grid = buildGrid(venueId);

  if (panel === 'alerts') {
    const alerts = buildAlerts(grid);
    return NextResponse.json(
      { alerts },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { data: grid },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
