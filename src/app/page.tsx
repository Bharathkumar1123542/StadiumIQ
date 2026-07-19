'use client';

import { useState } from 'react';
import Link from 'next/link';
import { VENUES } from '@/types';
import styles from './page.module.css';

// We delete the default page.module.css and define inline styles via global CSS
// to avoid Tailwind/module collisions. Landing page is pure globals.css classes.

export default function HomePage() {
  const [selectedVenue, setSelectedVenue] = useState(VENUES[0].venueId);

  return (
    <main className={styles.main}>
      {/* ── Hero ─────────────────────────────── */}
      <section className={styles.hero} aria-label="StadiumIQ platform overview">
        {/* Animated background orbs */}
        <div className={styles.orb1} aria-hidden="true" />
        <div className={styles.orb2} aria-hidden="true" />
        <div className={styles.orb3} aria-hidden="true" />

        <div className={styles.heroContent}>
          {/* Eyebrow */}
          <div className={styles.eyebrow}>
            <span className="badge badge--gold">⚽ FIFA World Cup 2026</span>
            <span className="badge badge--ai">GenAI-Powered</span>
          </div>

          {/* Wordmark */}
          <h1 className={styles.wordmark}>
            <span className="gradient-text">Stadium</span>
            <span className="gradient-text--gold">IQ</span>
          </h1>
          <p className={styles.tagline}>
            Real-time GenAI operations platform — multilingual concierge, crowd analytics,
            and AR navigation for 70,000 concurrent fans across 16 host venues.
          </p>

          {/* Venue selector */}
          <div className={styles.venuePicker}>
            <label htmlFor="venue-select" className={styles.venueLabel}>
              Select venue to demo
            </label>
            <select
              id="venue-select"
              className={`input ${styles.venueSelect}`}
              value={selectedVenue}
              onChange={e => setSelectedVenue(e.target.value)}
            >
              {VENUES.map(v => (
                <option key={v.venueId} value={v.venueId}>
                  {v.name} — {v.city} ({v.capacity.toLocaleString()} cap.)
                </option>
              ))}
            </select>
          </div>

          {/* CTA buttons */}
          <div className={styles.ctaRow}>
            <Link
              href={`/concierge?venue=${selectedVenue}`}
              className="btn btn--primary btn--lg"
              aria-label="Open fan concierge view"
            >
              <span aria-hidden="true">🎙</span>
              Fan Concierge
            </Link>
            <Link
              href={`/dashboard?venue=${selectedVenue}`}
              className="btn btn--gold btn--lg"
              aria-label="Open staff operations dashboard"
            >
              <span aria-hidden="true">📊</span>
              Ops Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ── Feature cards ────────────────────── */}
      <section className={styles.features} aria-label="Platform features">
        <div className={styles.featureGrid}>
          <article className={`card card--elevated ${styles.featureCard}`}>
            <div className={styles.featureIcon} aria-hidden="true">🎙</div>
            <h2 className={styles.featureTitle}>Multilingual Concierge</h2>
            <p className={styles.featureDesc}>
              GPT-4o voice + text agent in 30+ languages. RAG-grounded answers about
              your specific seat, gate, and venue — under 800 ms.
            </p>
            <ul className={styles.featurePills}>
              <li><span className="badge badge--ai">GPT-4o Primary</span></li>
              <li><span className="badge badge--gold">Gemini Fallback</span></li>
              <li><span className="badge badge--neutral">RAG · Pinecone</span></li>
            </ul>
          </article>

          <article className={`card card--elevated ${styles.featureCard}`}>
            <div className={styles.featureIcon} aria-hidden="true">🗺</div>
            <h2 className={styles.featureTitle}>AR Navigation</h2>
            <p className={styles.featureDesc}>
              BLE beacon trilateration + Kalman filter positioning at ≤1.5 m accuracy.
              Vision-to-audio descriptions for visually impaired fans.
            </p>
            <ul className={styles.featurePills}>
              <li><span className="badge badge--info">BLE · 400 beacons</span></li>
              <li><span className="badge badge--ai">GPT-4o Vision</span></li>
              <li><span className="badge badge--neutral">ARKit · ARCore</span></li>
            </ul>
          </article>

          <article className={`card card--elevated ${styles.featureCard}`}>
            <div className={styles.featureIcon} aria-hidden="true">🔥</div>
            <h2 className={styles.featureTitle}>Crowd Analytics</h2>
            <p className={styles.featureDesc}>
              YOLOv9-c + LSTM pipeline forecasting choke-points 5–15 min ahead.
              Real-time heatmaps from 48–64 cameras per venue.
            </p>
            <ul className={styles.featurePills}>
              <li><span className="badge badge--warn">LSTM · 5-min forecast</span></li>
              <li><span className="badge badge--neutral">YOLOv9-c · A10G GPU</span></li>
              <li><span className="badge badge--critical">L3 AR Reroute</span></li>
            </ul>
          </article>
        </div>
      </section>

      {/* ── Architecture stats ────────────────── */}
      <section className={styles.statsBar} aria-label="System scale statistics">
        {STATS.map(stat => (
          <div key={stat.label} className={styles.statItem}>
            <span className={`${styles.statValue} gradient-text`}>{stat.value}</span>
            <span className={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </section>

      {/* ── Footer ───────────────────────────── */}
      <footer className={styles.footer} role="contentinfo">
        <p>
          StadiumIQ · FIFA World Cup 2026 Hackathon Demo ·{' '}
          <span className="badge badge--neutral">No fan data persisted · Privacy-first</span>
        </p>
      </footer>
    </main>
  );
}

const STATS = [
  { value: '70K',   label: 'Concurrent fans / venue' },
  { value: '≤800ms',label: 'Concierge P95 latency'   },
  { value: '30+',   label: 'Languages supported'      },
  { value: '16',    label: 'Host venues'               },
  { value: '≤10s',  label: 'Heatmap staleness'        },
  { value: '≤1.5m', label: 'AR positioning accuracy'  },
];
