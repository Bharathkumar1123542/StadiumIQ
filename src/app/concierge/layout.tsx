import type { Metadata } from 'next';

/**
 * Per-route metadata for the fan concierge page.
 * This layout file allows us to export Metadata from a Server Component
 * while the page itself remains a Client Component.
 */
export const metadata: Metadata = {
  title: 'Fan Concierge — StadiumIQ · FIFA World Cup 2026',
  description:
    'Ask StadiumIQ anything about your venue in your native language. Get real-time directions, crowd levels, accessibility routes, and emergency assistance — powered by GPT-4o.',
};

export default function ConciergeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
