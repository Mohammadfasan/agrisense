import type { CalendarTaskRecord, CropCode, IsoDate } from '@agrisense/shared';
import type { TFunction } from 'i18next';

import { addDays, daysBetween, todayIso } from '@/shared/i18n/dates';

/**
 * The growth stages of a season, and which stage a task falls in.
 *
 * **These windows mirror `server/src/seed/cropStageTemplates.ts`.** The server
 * holds the agronomy in `cropStageTemplates` and generates a calendar from it,
 * but it puts no stage on the task it writes — a task carries a day, a type
 * and a title key — and no endpoint serves the stage rows. So a client that
 * groups a calendar by stage has to know the windows, and until there is a
 * `GET /crops/:code/stages` to read them from, knowing them means holding
 * them.
 *
 * That is a duplication and it is worth naming rather than hiding. It is the
 * same trade `CROP_GROWING_DAYS` in `@agrisense/shared` already makes for the
 * season length, with one difference that matters: the server asserts that
 * `CROP_GROWING_DAYS` agrees with its own numbers at boot, and nothing asserts
 * this. What protects it is that the two sides cannot disagree *silently* —
 * the seed checks that a crop's stages tile its season exactly from day 0 to
 * `CROP_GROWING_DAYS`, so the table below is checked against the same total
 * the shared package publishes, and a stage corrected on the server without
 * being corrected here shows up as a task in the wrong group rather than as a
 * wrong date. Nothing in the app *acts* on a stage; it is how a list of
 * nineteen tasks is cut into readable pieces.
 *
 * Offsets are whole days from the plot's sowing date, exactly as the server
 * measures them — never from the start of the stage, and never as instants.
 * `@agrisense/shared`'s `domain/dates.ts` has what UTC+05:30 does to the
 * alternative.
 */

/* -------------------------------------------------------------------------- */
/* The windows                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The stage names in use, as slugs.
 *
 * Shared across crops on purpose: "Flowering" is one stage name and one
 * translation whether it is a chilli or a brinjal flowering, and a key per
 * crop per stage would be twenty-five strings to translate where eleven do.
 */
export const STAGE_SLUGS = [
  'establishment',
  'tillering',
  'vegetative',
  'panicleInitiation',
  'flowering',
  'fruiting',
  'bulbInitiation',
  'bulbDevelopment',
  'ripening',
  'maturity',
  'harvest',
] as const;

export type StageSlug = (typeof STAGE_SLUGS)[number];

/** English, as the fallback when a catalogue has no `calendar.growthStage.*`. */
const STAGE_FALLBACK: Readonly<Record<StageSlug, string>> = {
  establishment: 'Establishment',
  tillering: 'Tillering',
  vegetative: 'Vegetative growth',
  panicleInitiation: 'Panicle initiation',
  flowering: 'Flowering',
  fruiting: 'Fruiting',
  bulbInitiation: 'Bulb initiation',
  bulbDevelopment: 'Bulb development',
  ripening: 'Ripening',
  maturity: 'Maturity',
  harvest: 'Harvest',
};

export interface StageWindow {
  slug: StageSlug;
  /** Whole days from the sowing date to the first day of the stage. */
  startOffsetDays: number;
  /** How many days the stage lasts. Stages abut and do not overlap. */
  durationDays: number;
}

/** Every crop's stages, in season order. Mirrors the seed named above. */
export const CROP_STAGES: Readonly<Record<CropCode, readonly StageWindow[]>> = {
  PADDY: [
    { slug: 'establishment', startOffsetDays: 0, durationDays: 14 },
    { slug: 'tillering', startOffsetDays: 14, durationDays: 26 },
    { slug: 'panicleInitiation', startOffsetDays: 40, durationDays: 25 },
    { slug: 'flowering', startOffsetDays: 65, durationDays: 30 },
    { slug: 'ripening', startOffsetDays: 95, durationDays: 25 },
  ],
  TOMATO: [
    { slug: 'establishment', startOffsetDays: 0, durationDays: 14 },
    { slug: 'vegetative', startOffsetDays: 14, durationDays: 21 },
    { slug: 'flowering', startOffsetDays: 35, durationDays: 20 },
    { slug: 'fruiting', startOffsetDays: 55, durationDays: 10 },
    { slug: 'harvest', startOffsetDays: 65, durationDays: 35 },
  ],
  CHILLI: [
    { slug: 'establishment', startOffsetDays: 0, durationDays: 15 },
    { slug: 'vegetative', startOffsetDays: 15, durationDays: 20 },
    { slug: 'flowering', startOffsetDays: 35, durationDays: 25 },
    { slug: 'fruiting', startOffsetDays: 60, durationDays: 30 },
    { slug: 'harvest', startOffsetDays: 90, durationDays: 40 },
  ],
  ONION: [
    { slug: 'establishment', startOffsetDays: 0, durationDays: 15 },
    { slug: 'vegetative', startOffsetDays: 15, durationDays: 20 },
    { slug: 'bulbInitiation', startOffsetDays: 35, durationDays: 20 },
    { slug: 'bulbDevelopment', startOffsetDays: 55, durationDays: 35 },
    { slug: 'maturity', startOffsetDays: 90, durationDays: 5 },
  ],
  BRINJAL: [
    { slug: 'establishment', startOffsetDays: 0, durationDays: 15 },
    { slug: 'vegetative', startOffsetDays: 15, durationDays: 20 },
    { slug: 'flowering', startOffsetDays: 35, durationDays: 25 },
    { slug: 'fruiting', startOffsetDays: 60, durationDays: 25 },
    { slug: 'harvest', startOffsetDays: 85, durationDays: 45 },
  ],
};

/** A stage's name in the farmer's language. */
export function stageName(slug: StageSlug, t: TFunction): string {
  return t(`calendar.growthStage.${slug}`, { defaultValue: STAGE_FALLBACK[slug] });
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The group a task lands in when it belongs to no stage of the season.
 *
 * Manual tasks mostly: a farmer's own note dated before sowing or after the
 * last stage ends has no stage to be in, and so does every task on a plot
 * whose sowing date is not recorded. They are grouped rather than hidden — a
 * task the farmer wrote is the last thing that should vanish because the
 * agronomy has nowhere to put it.
 */
export const OTHER_STAGE = 'other';

export type StageKey = StageSlug | typeof OTHER_STAGE;

export interface StageGroup {
  /** The group's stable key, and the stage name's i18n slug. */
  key: StageKey;
  /** The stage's first and last day, or `null` for {@link OTHER_STAGE}. */
  from: IsoDate | null;
  to: IsoDate | null;
  /** In `dueDate` order, completed work included. */
  tasks: CalendarTaskRecord[];
  /** How many are still `pending` — what the collapsed header counts. */
  outstanding: number;
  /** How many are pending and past their day. Drawn in the danger colour. */
  overdue: number;
  /** Today falls inside this stage. At most one group is current. */
  isCurrent: boolean;
}

/**
 * Cuts a plot's calendar into its growth stages.
 *
 * **Empty stages are dropped.** A season has five of them and a farmer with
 * three tasks left should see three groups, not five headings and two
 * apologies — the same rule the bucket list on `/plots/:id/calendar` follows.
 *
 * `today` is passed in so one render is drawn against one day, and so this is
 * testable without mocking the clock.
 */
export function groupByStage(
  tasks: readonly CalendarTaskRecord[],
  // Structurally the plot, rather than the record itself: this needs two
  // fields and a test has no business building the other twelve.
  plot: { crop: CropCode; sowingDate?: IsoDate | null | undefined },
  today: IsoDate = todayIso(),
): StageGroup[] {
  const sowingDate = plot.sowingDate ?? null;
  const windows = sowingDate === null ? [] : CROP_STAGES[plot.crop];

  // Seeded in season order, so the groups come out in it too, with the
  // catch-all last wherever it is filled from.
  const keys: StageKey[] = [...windows.map((window) => window.slug), OTHER_STAGE];
  const groups = new Map<StageKey, CalendarTaskRecord[]>(keys.map((key) => [key, []]));

  for (const task of tasks) {
    const key =
      sowingDate === null
        ? OTHER_STAGE
        : (stageOf(windows, offsetOf(sowingDate, task.dueDate)) ?? OTHER_STAGE);
    groups.get(key)?.push(task);
  }

  const currentSlug = sowingDate === null ? null : stageOf(windows, offsetOf(sowingDate, today));

  return [...groups.entries()]
    .filter(([, grouped]) => grouped.length > 0)
    .map(([key, grouped]) => {
      const window = windows.find((candidate) => candidate.slug === key);
      const pending = grouped.filter((task) => task.status === 'pending');

      return {
        key,
        from:
          window === undefined || sowingDate === null
            ? null
            : addDays(sowingDate, window.startOffsetDays),
        to:
          window === undefined || sowingDate === null
            ? null
            : addDays(sowingDate, window.startOffsetDays + window.durationDays - 1),
        // Sorted here rather than trusted from the caller: a plot's calendar
        // arrives in date order, but a task the farmer moved to another day
        // lands wherever the optimistic cache update put it.
        tasks: [...grouped].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
        outstanding: pending.length,
        overdue: pending.filter((task) => task.dueDate < today).length,
        isCurrent: key === currentSlug,
      };
    });
}

/**
 * Which group opens when the screen is first drawn.
 *
 * The stage the farmer is standing in, because that is the question the screen
 * is open to answer. Failing that — a season not started, a season finished,
 * or a current stage with nothing in it — the earliest group with outstanding
 * work, and failing *that* the last group, which for a finished season is the
 * harvest. `null` only when there is nothing at all.
 */
export function defaultOpenStage(groups: readonly StageGroup[]): StageKey | null {
  const current = groups.find((group) => group.isCurrent);
  const outstanding = groups.find((group) => group.outstanding > 0);

  return (current ?? outstanding ?? groups.at(-1))?.key ?? null;
}

/* -------------------------------------------------------------------------- */

/** Whole days from sowing, or `NaN` for a day this app cannot read. */
function offsetOf(sowingDate: IsoDate, date: IsoDate): number {
  return daysBetween(sowingDate, date);
}

/**
 * The stage an offset falls in, or `null` when it falls outside the season.
 *
 * Half-open windows — `[start, start + duration)` — because the stages abut:
 * day 14 of a paddy season is the first day of tillering, not the last day of
 * establishment, and a closed window would put it in both.
 */
function stageOf(windows: readonly StageWindow[], offsetDays: number): StageSlug | null {
  if (Number.isNaN(offsetDays)) {
    return null;
  }
  return (
    windows.find(
      (window) =>
        offsetDays >= window.startOffsetDays &&
        offsetDays < window.startOffsetDays + window.durationDays,
    )?.slug ?? null
  );
}
