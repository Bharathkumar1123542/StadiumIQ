'use client';

import { type AlertSeverity, type LLMProvider, type ModerationCategory } from '@/types';

// ── Generic badge ─────────────────────────────────────────────

interface BadgeProps {
  variant: 'ok' | 'warn' | 'critical' | 'info' | 'neutral' | 'ai' | 'gold';
  children: React.ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({ variant, children, dot = false, pulse = false, className = '' }: BadgeProps) {
  return (
    <span
      className={`badge badge--${variant} ${className}`}
      role="status"
      aria-label={typeof children === 'string' ? children : undefined}
    >
      {dot && (
        <span
          className={`dot dot--${variant === 'ok' ? 'ok' : variant === 'warn' ? 'warn' : 'critical'} ${pulse ? 'dot--pulse' : ''}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

// ── Alert severity badge ──────────────────────────────────────

interface AlertBadgeProps {
  severity: AlertSeverity;
  showLabel?: boolean;
}

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; variant: BadgeProps['variant'] }> = {
  1: { label: 'Advisory',  variant: 'info'     },
  2: { label: 'Warning',   variant: 'warn'     },
  3: { label: 'Critical',  variant: 'critical' },
};

export function AlertSeverityBadge({ severity, showLabel = true }: AlertBadgeProps) {
  const config = SEVERITY_CONFIG[severity];
  return (
    <StatusBadge
      variant={config.variant}
      dot
      pulse={severity === 3}
      aria-label={`Alert severity ${severity}: ${config.label}`}
    >
      {showLabel ? `L${severity} ${config.label}` : `L${severity}`}
    </StatusBadge>
  );
}

// ── LLM provider badge ────────────────────────────────────────

interface LLMBadgeProps {
  provider: LLMProvider;
}

const LLM_CONFIG: Record<LLMProvider, { label: string; variant: BadgeProps['variant'] }> = {
  openai:   { label: '⚡ GPT-4o',       variant: 'ai'      },
  gemini:   { label: '✦ Gemini Flash',  variant: 'gold'    },
  fallback: { label: '⚠ Cached',        variant: 'neutral' },
};

export function LLMProviderBadge({ provider }: LLMBadgeProps) {
  const config = LLM_CONFIG[provider];
  return (
    <StatusBadge
      variant={config.variant}
      aria-label={`LLM provider: ${config.label}`}
    >
      {config.label}
    </StatusBadge>
  );
}

// ── Moderation badge ──────────────────────────────────────────

interface ModerationBadgeProps {
  category: ModerationCategory;
}

const MOD_CONFIG: Record<ModerationCategory, { label: string; variant: BadgeProps['variant'] }> = {
  safe:             { label: '✓ Safe',            variant: 'ok'      },
  pii_leakage:      { label: '⚠ PII Redacted',    variant: 'warn'    },
  off_topic:        { label: '⊘ Off-topic',        variant: 'neutral' },
  competitor_brand: { label: '⊘ Brand Filtered',  variant: 'neutral' },
};

export function ModerationBadge({ category }: ModerationBadgeProps) {
  const config = MOD_CONFIG[category];
  return (
    <StatusBadge variant={config.variant} aria-label={`Moderation: ${config.label}`}>
      {config.label}
    </StatusBadge>
  );
}

// ── System health badge ───────────────────────────────────────

interface HealthBadgeProps {
  status: 'ok' | 'degraded' | 'down';
  label?: string;
}

export function HealthBadge({ status, label }: HealthBadgeProps) {
  const variant = status === 'ok' ? 'ok' : status === 'degraded' ? 'warn' : 'critical';
  const defaultLabel = status === 'ok' ? 'Online' : status === 'degraded' ? 'Degraded' : 'Down';
  return (
    <StatusBadge variant={variant} dot pulse={status !== 'ok'}>
      {label ?? defaultLabel}
    </StatusBadge>
  );
}
