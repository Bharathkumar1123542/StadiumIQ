import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { NavBar } from '@/components/shared/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'StadiumIQ — FIFA World Cup 2026 AI Operations Platform',
  description:
    'GenAI-powered multilingual fan concierge, real-time crowd analytics, and AR navigation for FIFA World Cup 2026 — serving 70,000 concurrent fans across 16 host venues.',
  keywords: ['FIFA', 'World Cup 2026', 'AI', 'stadium', 'concierge', 'crowd analytics'],
  authors: [{ name: 'StadiumIQ Team' }],
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080B12',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {/* Skip-to-content link for keyboard/screen-reader users */}
        <a
          href="#main-content"
          className="sr-only"
          style={{
            // Override sr-only on :focus so the link becomes visible
          }}
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

        <div className="page-wrapper">
          {/* NavBar uses useSearchParams → must be wrapped in Suspense */}
          <Suspense fallback={null}>
            <NavBar />
          </Suspense>
          {/*
            Use a <div> here (not <main>) because individual pages render
            their own <main> landmark. Nesting <main> inside <main> is
            invalid HTML and breaks screen-reader navigation.
          */}
          <div id="main-content" className="page-main" tabIndex={-1}>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
