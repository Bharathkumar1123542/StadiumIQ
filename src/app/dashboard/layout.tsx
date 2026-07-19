import type { Metadata } from 'next';

/**
 * Per-route metadata for the staff operations dashboard.
 * This layout file allows us to export Metadata from a Server Component
 * while the page itself remains a Client Component.
 */
export const metadata: Metadata = {
  title: 'Ops Dashboard — StadiumIQ · FIFA World Cup 2026',
  description:
    'Real-time staff operations dashboard: live crowd density heatmaps, AI-generated situation briefs, active alerts, and fan escalation queue across all FIFA World Cup 2026 host venues.',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
