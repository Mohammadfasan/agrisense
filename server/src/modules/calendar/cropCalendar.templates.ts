import { z } from 'zod';

import { CROP_CODES, CROP_GROWING_DAYS, activityTypeSchema, type CropCode } from '@shared';

import templateFile from '../../data/crop-calendar-templates.json';

/**
 * The crop calendars: what to do, and how many days after planting.
 *
 * The agronomy lives in `server/src/data/crop-calendar-templates.json` rather
 * than in this file, and that is the point of the arrangement. Every number in
 * it — when to top-dress paddy, when chilli anthracnose is worth scouting for
 * — is a claim about farming that a developer is not qualified to make and an
 * agronomist is. Keeping it as data means the person who can correct it can
 * open it, read it, and change it without touching TypeScript, and the diff of
 * that change is a list of days rather than a code review.
 *
 * It ships **unreviewed**. The file says so in its own `reviewStatus` field.
 *
 * Text is not in it either: an activity carries i18n *keys*, not sentences.
 * The server has no business deciding which of three languages to store a
 * farmer's calendar in, and the farmer may switch language after the calendar
 * is generated. The client translates at render time.
 */

const activitySchema = z.object({
  /** Whole days from `plots.plantedAt`. 0 is planting day itself. */
  dayOffset: z.number().int().min(0),
  type: activityTypeSchema,
  /** i18n key, e.g. `calendar.task.paddy.topDressing1.title`. */
  titleKey: z.string().min(1).max(100),
  descriptionKey: z.string().min(1).max(500),
});

const cropTemplateSchema = z
  .object({
    /** Planting to final harvest, for the progress bar on the client. */
    totalDays: z.number().int().min(1).max(730),
    activities: z.array(activitySchema).min(1),
  })
  .superRefine((template, ctx) => {
    template.activities.forEach((activity, index) => {
      // An activity after the season ends is a typo -- a transposed 15 and 51
      // reads perfectly well on its own line and puts a weeding task two
      // months after the harvest.
      if (activity.dayOffset > template.totalDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['activities', index, 'dayOffset'],
          message: `must not fall after totalDays (${String(template.totalDays)})`,
        });
      }
    });
  });

const templateFileSchema = z.object({
  version: z.number().int().min(1),
  crops: z.record(z.enum(CROP_CODES), cropTemplateSchema).superRefine((crops, ctx) => {
    // A crop with no calendar is not an error anyone would see: the plot saves
    // fine and simply never grows a task. Caught here, at boot, instead.
    for (const code of CROP_CODES) {
      if (crops[code] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [code],
          message: 'every supported crop needs a calendar',
        });
      }
    }
  }),
});

export type CropActivity = z.infer<typeof activitySchema>;
export type CropCalendarTemplate = z.infer<typeof cropTemplateSchema>;

/**
 * Parsed once, at import, so a hand-edited file with a bad crop code or a
 * negative offset stops the server at boot rather than on the first plot a
 * farmer plants. The file is the one input here nobody type-checks.
 */
const calendar = ((): { version: number; crops: Record<CropCode, CropCalendarTemplate> } => {
  const parsed = templateFileSchema.safeParse(templateFile);

  if (!parsed.success) {
    const where = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`crop-calendar-templates.json is invalid — ${where}`);
  }
  // The client draws its crop-stage bar from `CROP_GROWING_DAYS` in
  // `@agrisense/shared`, which cannot read this file. Checked here rather than
  // kept in step by hand: a season length corrected by an agronomist in the
  // JSON and not in the package would put every plot's progress bar at the
  // wrong fraction, silently, and only on the client.
  for (const code of CROP_CODES) {
    const { totalDays } = parsed.data.crops[code] ?? { totalDays: 0 };
    if (totalDays !== CROP_GROWING_DAYS[code]) {
      throw new Error(
        `crop-calendar-templates.json disagrees with CROP_GROWING_DAYS for ${code}: ` +
          `${String(totalDays)} vs ${String(CROP_GROWING_DAYS[code])}`,
      );
    }
  }

  return {
    version: parsed.data.version,
    // The refinement above has established that every code is present, which
    // the inferred partial record cannot say in the type.
    crops: parsed.data.crops as Record<CropCode, CropCalendarTemplate>,
  };
})();

/** The version of the agronomy this build carries, for logs and support. */
export const CROP_CALENDAR_VERSION: number = calendar.version;

/**
 * The calendar for a crop, with its activities in day order.
 *
 * Sorted here rather than trusted from the file: the file is meant to be
 * edited by hand, and an activity inserted in the wrong place should not
 * decide what order a farmer's first week reads in.
 */
export function templateFor(crop: CropCode): CropCalendarTemplate {
  const template = calendar.crops[crop];

  return {
    totalDays: template.totalDays,
    activities: [...template.activities].sort((a, b) => a.dayOffset - b.dayOffset),
  };
}
