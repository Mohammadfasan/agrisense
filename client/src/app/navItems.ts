import { House, MapPin, ScanLine, User, type LucideIcon } from 'lucide-react';

import type { FeatureKey } from './features';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
  fallback: string;
  /** Match the path exactly. Without it, "/" would be active on every page. */
  end?: boolean;
  /**
   * The flag that decides whether this is a link or a dimmed label. Omitted
   * where the destination is always there.
   */
  feature?: FeatureKey;
}

/**
 * The farmer app's destinations, shared by the bottom nav and the sidebar so the
 * two can never disagree. The officer portal has its own shell and is not here.
 *
 * Four, and no more. A fifth column on a 360px phone is 72px wide, which is
 * under the 48px target plus the gap either side of it once a Tamil or Sinhala
 * label has wrapped underneath. Market prices used to be the fifth; it has no
 * data behind it until Week 7 and lives on the home screen as a card marked
 * "coming soon" until then.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', icon: House, labelKey: 'nav.home', fallback: 'Home', end: true },
  { to: '/plots', icon: MapPin, labelKey: 'nav.plots', fallback: 'Plots', feature: 'plots' },
  { to: '/scan', icon: ScanLine, labelKey: 'nav.scan', fallback: 'Scan', feature: 'scan' },
  { to: '/profile', icon: User, labelKey: 'nav.profile', fallback: 'Profile', feature: 'profile' },
];
