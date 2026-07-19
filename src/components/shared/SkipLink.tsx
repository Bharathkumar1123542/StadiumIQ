'use client';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only"
      onFocus={(e) => {
        e.currentTarget.style.cssText =
          'position:fixed;top:8px;left:8px;z-index:99999;padding:0.5rem 1rem;' +
          'background:var(--ai-primary);color:#fff;border-radius:6px;font-weight:600;' +
          'width:auto;height:auto;clip:auto;overflow:visible;white-space:nowrap;';
      }}
      onBlur={(e) => {
        e.currentTarget.removeAttribute('style');
      }}
    >
      Skip to main content
    </a>
  );
}
