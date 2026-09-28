export type FeatureKey = 'plots' | 'scan' | 'prices' | 'notifications' | 'profile';

export interface Feature {
  /** Flip to `true` when the feature behind it ships. */
  readonly enabled: boolean;
  /**
   * When that is expected, for whoever reads this next. Not rendered: a date
   * on a badge is a promise the screen cannot keep.
   */
  readonly plannedFor?: string;
}

export const FEATURES: Readonly<Record<FeatureKey, Feature>> = {
  plots: { enabled: true },
  profile: { enabled: true },
  scan: { enabled: true, plannedFor: 'Week 5 — disease model + scan history' },
  prices: { enabled: false, plannedFor: 'Week 7 — market price scrapers' },
  notifications: { enabled: false, plannedFor: 'Week 8 — outbreak alerts' },
};

/** Sugar for the read that happens at every call site. */
export function isEnabled(key: FeatureKey): boolean {
  return FEATURES[key].enabled;
}
