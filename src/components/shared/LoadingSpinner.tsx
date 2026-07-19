'use client';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ai' | 'gold' | 'neutral';
  label?: string;
}

const SIZE_MAP = { sm: 18, md: 28, lg: 44 };

export function LoadingSpinner({ size = 'md', variant = 'ai', label = 'Loading…' }: SpinnerProps) {
  const px = SIZE_MAP[size];
  const color = variant === 'ai' ? 'var(--ai-primary)' : variant === 'gold' ? 'var(--fifa-gold-bright)' : 'var(--text-tertiary)';

  return (
    <span
      role="status"
      aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ animation: 'spin 0.8s linear infinite' }}
      >
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" opacity="0.2" />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Inline AI "thinking" dots — used inside chat bubbles */
export function ThinkingDots() {
  return (
    <span className="ai-thinking" role="status" aria-label="AI is generating a response">
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </span>
  );
}

/** Full-page centered loading state */
export function PageLoader({ message = 'Loading StadiumIQ…' }: { message?: string }) {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
      }}
      role="status"
      aria-label={message}
    >
      <LoadingSpinner size="lg" variant="ai" label={message} />
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{message}</p>
    </div>
  );
}
