import { House, LineChart, MapPin, ScanLine, User, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
  fallback: string;
  /** Match the path exactly. Without it, "/" would be active on every page. */
  end?: boolean;
}

/**
 * The farmer app's destinations, shared by the bottom nav and the sidebar so the
 * two can never disagree. The officer portal has its own shell and is not here.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', icon: House, labelKey: 'nav.home', fallback: 'Home', end: true },
  { to: '/plots', icon: MapPin, labelKey: 'nav.plots', fallback: 'Plots' },
  { to: '/scan', icon: ScanLine, labelKey: 'nav.scan', fallback: 'Scan' },
  { to: '/market', icon: LineChart, labelKey: 'nav.market', fallback: 'Market' },
  { to: '/profile', icon: User, labelKey: 'nav.profile', fallback: 'Profile' },
];
