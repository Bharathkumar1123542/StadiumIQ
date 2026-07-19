'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { VENUES } from '@/types';
import styles from './NavBar.module.css';

const NAV_ITEMS = [
  { href: '/',           icon: '🏠', label: 'Home'      },
  { href: '/concierge',  icon: '🎙', label: 'Concierge' },
  { href: '/dashboard',  icon: '📊', label: 'Ops Dashboard' },
] as const;

export function NavBar() {
  const pathname      = usePathname();
  const searchParams  = useSearchParams();
  const venueId       = searchParams.get('venue') ?? VENUES[0].venueId;
  const venueMeta     = VENUES.find(v => v.venueId === venueId) ?? VENUES[0];

  /** Preserve the ?venue= param across nav links */
  const withVenue = (href: string) =>
    href === '/' ? href : `${href}?venue=${venueId}`;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className={styles.nav} aria-label="StadiumIQ main navigation">
      <div className={styles.inner}>
        {/* Brand */}
        <Link href="/" className={styles.brand} aria-label="StadiumIQ home">
          <span className={styles.brandIcon} aria-hidden="true">⚽</span>
          <span className={styles.brandName}>
            <span className="gradient-text">Stadium</span>
            <span className="gradient-text--gold">IQ</span>
          </span>
        </Link>

        {/* Navigation links */}
        <ul className={styles.links} role="list">
          {NAV_ITEMS.map(({ href, icon, label }) => (
            <li key={href}>
              <Link
                href={withVenue(href)}
                className={`${styles.link} ${isActive(href) ? styles.active : ''}`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                <span className={styles.linkIcon} aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Right actions */}
        <div className={styles.actions}>
          <div
            className={styles.venuePill}
            title={`${venueMeta.name}, ${venueMeta.city}`}
            aria-label={`Active venue: ${venueMeta.name}`}
          >
            <span className={styles.venueDot} aria-hidden="true" />
            {venueMeta.name}
          </div>
        </div>
      </div>
    </nav>
  );
}
