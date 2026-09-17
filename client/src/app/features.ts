/**
 * What the farmer app can actually do today.
 *
 * Half the screens in the plan have no data behind them yet: the model that
 * reads a leaf is Week 5 work, and market prices arrive with the scrapers
 * after that. Both are still on the home screen and in the navigation,
 * because a farmer should be able to see what the app will do — but as
 * something plainly marked "coming soon" rather than as a tap that leads
 * nowhere or, worse, to a screen of invented numbers.
 *
 * One flag per feature, read in three places — the navigation, the home
 * screen's cards, and the router — so turning a feature on is editing the
 * `false` on its line here and nothing else. That is the whole point of the
 * file: the alternative is a `disabled` prop and a commented-out route per
 * feature, scattered across the app and impossible to grep for on the day
 * somebody has to switch one on.
 *
 * Deliberately constants rather than an API-driven flag service. Nothing here
 * varies per farmer or per environment; these are release gates for work that
 * does not exist yet, and they disappear one by one as it lands.
 */

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
  scan: { enabled: false, plannedFor: 'Week 5 — disease model + scan history' },
  prices: { enabled: false, plannedFor: 'Week 7 — market price scrapers' },
  notifications: { enabled: false, plannedFor: 'Week 8 — outbreak alerts' },
};

/** Sugar for the read that happens at every call site. */
export function isEnabled(key: FeatureKey): boolean {
  return FEATURES[key].enabled;
}
