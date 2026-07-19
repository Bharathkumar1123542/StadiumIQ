'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  type CrowdGrid,
  type CrowdAlert,
  type EscalationTicket,
  type SystemHealthMetric,
  type AlertSeverity,
  VENUES,
  LANGUAGES,
} from '@/types';
import { AlertSeverityBadge, HealthBadge } from '@/components/shared/StatusBadge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import styles from './dashboard.module.css';

// ── Constants ─────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 8_000;

// ── Helpers ───────────────────────────────────────────────────────
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelative(ts: number) {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  return `${Math.round(diff / 60)}m ago`;
}

// ── Heatmap cell ──────────────────────────────────────────────────
function HeatCell({
  bucket,
  chokeProbability,
  density,
  cameraOnline,
  zoneName,
  cellId,
}: {
  bucket: 0 | 1 | 2 | 3 | 4 | 5 | 'null';
  chokeProbability: number | null;
  density: number | null;
  cameraOnline: boolean;
  zoneName: string;
  cellId: string;
}) {
  const isChoke = chokeProbability !== null && chokeProbability > 0.75;
  const heatClass = cameraOnline ? `heat-${bucket}` : 'heat-null';
  const title = cameraOnline
    ? `${zoneName} · ${density?.toFixed(1) ?? '?'} p/m² · choke ${((chokeProbability ?? 0) * 100).toFixed(0)}%`
    : `${zoneName} · Camera offline`;

  return (
    <div
      className={`${styles.heatCell} ${heatClass} ${isChoke ? styles['heatCell--choke'] : ''}`}
      title={title}
      aria-label={title}
      role="img"
      data-tooltip={title}
      id={`cell-${cellId}`}
    >
      {isChoke && (
        <span className={styles.cellLabel} aria-hidden="true">!</span>
      )}
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────
function AlertCard({
  alert,
  onAcknowledge,
  onDispatch,
}: {
  alert: CrowdAlert & { aiBrief?: string };
  onAcknowledge: (alertId: string) => void;
  onDispatch: (zoneName: string) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const cardClass =
    alert.severity === 3 ? styles['alertCard--critical'] :
    alert.severity === 2 ? styles['alertCard--warning'] :
                           styles['alertCard--advisory'];

  return (
    <article
      className={`${styles.alertCard} ${cardClass} ${acknowledged ? styles['alertCard--acknowledged'] ?? '' : ''}`}
      aria-label={`Alert: ${alert.zoneName}, severity level ${alert.severity}${
        acknowledged ? ', acknowledged' : ''
      }`}
    >
      <div className={styles.alertTop}>
        <span className={styles.alertZone}>{alert.zoneName}</span>
        <AlertSeverityBadge severity={alert.severity} />
      </div>
      <p className={styles.alertBody}>
        {alert.currentDensity.toFixed(1)} p/m² · choke {(alert.chokeProbability * 100).toFixed(0)}%
        {alert.arRerouteActive && ' · 🔀 AR reroute active'}
        {alert.fanPushSent && ' · 📱 Push sent'}
      </p>
      {alert.aiBrief && (
        <div className={styles.alertBrief}>
          <p className={styles.alertBriefLabel}>✶ AI Situation Brief</p>
          {alert.aiBrief}
        </div>
      )}
      <div className={styles.alertActions}>
        <button
          className="btn btn--sm btn--outline"
          aria-label={`Acknowledge alert for ${alert.zoneName}`}
          id={`ack-btn-${alert.alertId}`}
          disabled={acknowledged}
          onClick={() => {
            setAcknowledged(true);
            onAcknowledge(alert.alertId);
          }}
        >
          {acknowledged ? '✓ Acknowledged' : '✓ Acknowledge'}
        </button>
        {alert.severity === 3 && (
          <button
            className="btn btn--sm btn--danger"
            aria-label={`Dispatch stewards to ${alert.zoneName}`}
            id={`dispatch-btn-${alert.alertId}`}
            onClick={() => onDispatch(alert.zoneName)}
          >
            🚨 Dispatch
          </button>
        )}
      </div>
    </article>
  );
}

// ── Escalation ticket ─────────────────────────────────────────────
function EscalationCard({
  ticket,
  onClaim,
}: {
  ticket: EscalationTicket;
  onClaim: (ticketId: string) => void;
}) {
  const [claimed, setClaimed] = useState(false);
  const langMeta = LANGUAGES[ticket.languageCode];
  return (
    <article
      className={styles.escalationCard}
      aria-label={`Escalation from session in ${langMeta?.englishName ?? ticket.languageCode}${
        claimed ? ', claimed' : ''
      }`}
    >
      <span className={styles.escalationLang}>
        {langMeta?.flag ?? '🌐'} {langMeta?.englishName ?? ticket.languageCode} · {ticket.zoneId ?? 'Unknown zone'}
      </span>
      <p className={styles.escalationMsg}>{ticket.triggerMessage}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span className={styles.escalationTime}>{formatRelative(ticket.createdAt)}</span>
        <button
          className="btn btn--sm btn--outline"
          aria-label={`Claim escalation ticket ${ticket.ticketId}`}
          id={`claim-btn-${ticket.ticketId}`}
          disabled={claimed}
          onClick={() => {
            setClaimed(true);
            onClaim(ticket.ticketId);
          }}
        >
          {claimed ? 'Claimed' : 'Claim'}
        </button>
      </div>
    </article>
  );
}

// ── Health metric card ────────────────────────────────────────────
function HealthCard({ metric }: { metric: SystemHealthMetric }) {
  return (
    <div className={styles.healthCard}>
      <span className={styles.healthLabel}>
        {metric.service === 'concierge' ? '🎙 Concierge' :
         metric.service === 'navigation' ? '🗺 Navigation' :
         '🔥 Crowd AI'}
      </span>
      <span className={styles.healthValue} aria-label={`P95 latency: ${metric.p95LatencyMs}ms`}>
        {metric.p95LatencyMs}ms
      </span>
      <HealthBadge status={metric.status} />
      <span className={styles.healthMeta}>
        {metric.activeSessionCount.toLocaleString()} sessions
      </span>
    </div>
  );
}

// ── Main dashboard page ───────────────────────────────────────────
export default function DashboardPage() {
  const searchParams  = useSearchParams();
  const venueId       = searchParams.get('venue') ?? VENUES[0].venueId;
  const venueMeta     = VENUES.find(v => v.venueId === venueId) ?? VENUES[0];

  const [crowd, setCrowd]               = useState<CrowdGrid | null>(null);
  const [alerts, setAlerts]             = useState<(CrowdAlert & { aiBrief?: string })[]>([]);
  const [escalations, setEscalations]   = useState<EscalationTicket[]>([]);
  const [health, setHealth]             = useState<SystemHealthMetric[]>([]);
  const [lastRefresh, setLastRefresh]   = useState<number | null>(null);
  const [loading, setLoading]           = useState(true);
  const [staleSince, setStaleSince]     = useState<number | null>(null);
  const [dispatchToast, setDispatchToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useId();

  /** Show an accessible toast notification that auto-dismisses after 4 s. */
  const showToast = useCallback((message: string) => {
    setDispatchToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setDispatchToast(null), 4000);
  }, []);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCrowd = useCallback(async () => {
    try {
      const res = await fetch(`/api/crowd?venue=${venueId}`);
      if (!res.ok) throw new Error('crowd fetch failed');
      const json = await res.json();
      setCrowd(json.data);
      setLastRefresh(Date.now());
      setStaleSince(null);
      setLoading(false);
    } catch {
      setStaleSince(prev => prev ?? Date.now());
    }
  }, [venueId]);

  const fetchSidePanel = useCallback(async () => {
    try {
      const [alertRes, escRes, healthRes] = await Promise.allSettled([
        fetch(`/api/crowd?venue=${venueId}&panel=alerts`),
        fetch(`/api/escalate?venue=${venueId}`),
        fetch(`/api/health?venue=${venueId}`),
      ]);

      if (alertRes.status === 'fulfilled' && alertRes.value.ok) {
        const j = await alertRes.value.json();
        if (j.alerts) setAlerts(j.alerts);
      }
      if (escRes.status === 'fulfilled' && escRes.value.ok) {
        const j = await escRes.value.json();
        if (j.tickets) setEscalations(j.tickets);
      }
      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        const j = await healthRes.value.json();
        if (j.metrics) setHealth(j.metrics);
      }
    } catch {
      // Side-panel failure is non-fatal; heatmap continues working
    }
  }, [venueId]);

  useEffect(() => {
    fetchCrowd();
    fetchSidePanel();
    timerRef.current = setInterval(() => {
      fetchCrowd();
      fetchSidePanel();
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchCrowd, fetchSidePanel]);

  // ── Derived stats ──────────────────────────────────────────────
  const highestSeverity: AlertSeverity | null = alerts.length
    ? (Math.max(...alerts.map(a => a.severity)) as AlertSeverity)
    : null;

  const totalChokeCells = crowd?.cells.flat().filter(
    c => c.chokeProbability !== null && c.chokeProbability > 0.75
  ).length ?? 0;

  const cols = crowd?.cells[0]?.length ?? 12;

  return (
    <div className={styles.page}>
      {/* ── Dispatch toast notification ──────── */}
      {dispatchToast && (
        <div
          id={toastId}
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          style={{
            position: 'fixed',
            top: '80px',
            right: '1.5rem',
            zIndex: 9999,
            background: 'var(--status-critical-dim)',
            border: '1px solid var(--status-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1.25rem',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            maxWidth: '360px',
          }}
        >
          {dispatchToast}
        </div>
      )}

      {/* ── Header ──────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>
            <span aria-hidden="true">📊</span>
            Ops Dashboard
          </h1>
          <p className={styles.headerSub}>
            {venueMeta.name} · {venueMeta.city} ·{' '}
            {lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading…'}
          </p>
        </div>

        <div className={styles.headerRight}>
          {highestSeverity && (
            <AlertSeverityBadge severity={highestSeverity} />
          )}
          <button
            id="manual-refresh-btn"
            className="btn btn--sm btn--outline"
            onClick={() => { fetchCrowd(); fetchSidePanel(); }}
            aria-label="Manually refresh dashboard data"
          >
            ↺ Refresh
          </button>
        </div>
      </header>

      {/* ── Main column ─────────────────────── */}
      <div className={styles.mainCol}>
        {/* Health strip */}
        {health.length > 0 && (
          <section aria-label="System health metrics">
            <div className={styles.healthStrip}>
              {health.map(m => <HealthCard key={m.service} metric={m} />)}
              <div className={styles.healthCard}>
                <span className={styles.healthLabel}>⚠ Choke Zones</span>
                <span
                  className={styles.healthValue}
                  style={{ color: totalChokeCells > 0 ? 'var(--status-critical)' : 'var(--status-ok)' }}
                  aria-label={`${totalChokeCells} choke zones detected`}
                >
                  {totalChokeCells}
                </span>
                <span className={styles.healthMeta}>prob &gt; 75%</span>
              </div>
            </div>
          </section>
        )}

        {/* Heatmap */}
        <section className={styles.heatmapSection} aria-label="Crowd density heatmap">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              <span aria-hidden="true">🔥</span>
              Crowd Density · {venueMeta.name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {crowd?.degradedMode && (
                <span className={styles.staleBadge} role="alert">⚠ Degraded (&gt;30% cameras down)</span>
              )}
              {staleSince && (
                <span className={styles.staleBadge} role="alert">
                  Stale {formatRelative(staleSince)}
                </span>
              )}
            </div>
          </div>

          <div className={styles.heatmapCard}>
            {loading ? (
              <div
                style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
                role="status"
                aria-label="Loading heatmap"
              >
                <LoadingSpinner size="lg" variant="ai" label="Loading crowd data…" />
              </div>
            ) : crowd ? (
              <>
                <div
                  className={styles.heatmapGrid}
                  style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                  role="grid"
                  aria-label={`${venueMeta.name} crowd density grid`}
                >
                  {crowd.cells.flat().map((cell) => (
                    <HeatCell
                      key={cell.cellId}
                      bucket={cell.heatBucket}
                      chokeProbability={cell.chokeProbability}
                      density={cell.density}
                      cameraOnline={cell.cameraOnline}
                      zoneName={cell.zoneName}
                      cellId={cell.cellId}
                    />
                  ))}
                </div>

                {/* Legend */}
                <div className={styles.legend} aria-label="Heatmap density legend">
                  {[
                    { cls: 'heat-0', label: 'Empty' },
                    { cls: 'heat-1', label: 'Low' },
                    { cls: 'heat-2', label: 'Moderate' },
                    { cls: 'heat-3', label: 'Dense' },
                    { cls: 'heat-4', label: 'Critical' },
                    { cls: 'heat-5', label: 'Extreme' },
                    { cls: 'heat-null', label: 'Camera down' },
                  ].map(({ cls, label }) => (
                    <div key={cls} className={styles.legendItem}>
                      <span className={`${styles.legendSwatch} ${cls}`} aria-hidden="true" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>📡</span>
                <p>Crowd data unavailable. Last known state may be displayed.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Right sidebar ────────────────────── */}
      <aside className={styles.sidebar} aria-label="Operations sidebar">
        {/* Active alerts */}
        <section className={styles.sidebarSection} aria-label="Active crowd alerts">
          <h2 className={styles.sidebarSectionTitle}>
            🚨 Active Alerts ({alerts.length})
          </h2>
          {alerts.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>✅</span>
              <p>No active alerts</p>
            </div>
          ) : (
            alerts.map(alert => (
              <AlertCard
                key={alert.alertId}
                alert={alert}
                onAcknowledge={(id) => setAlerts(prev => prev.filter(a => a.alertId !== id))}
                onDispatch={(zoneName) => showToast(`🚨 Steward dispatch request sent for ${zoneName}`)}
              />
            ))
          )}
        </section>

        {/* Escalation queue */}
        <section className={styles.sidebarSection} aria-label="Fan escalation queue">
          <h2 className={styles.sidebarSectionTitle}>
            📋 Escalations ({escalations.filter(e => e.status === 'open').length} open)
          </h2>
          {escalations.filter(e => e.status === 'open').length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>💬</span>
              <p>No open escalations</p>
            </div>
          ) : (
            escalations
              .filter(e => e.status === 'open')
              .slice(0, 5)
              .map(ticket => (
                <EscalationCard
                  key={ticket.ticketId}
                  ticket={ticket}
                  onClaim={(id) => setEscalations(prev =>
                    prev.map(t => t.ticketId === id ? { ...t, status: 'claimed' as const } : t)
                  )}
                />
              ))
          )}
        </section>

        {/* Refresh indicator */}
        <div className={styles.refreshBar} aria-live="polite">
          <span>
            <span className={styles.refreshDot} aria-hidden="true" />{' '}
            Auto-refresh every {POLL_INTERVAL_MS / 1000}s
          </span>
          <span>{lastRefresh ? formatTime(lastRefresh) : '—'}</span>
        </div>
      </aside>
    </div>
  );
}
