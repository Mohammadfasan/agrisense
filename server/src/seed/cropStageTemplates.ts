import { randomUUID } from 'node:crypto';

import { connectDatabase, disconnectDatabase, logger } from '@config';
import { CropStageTemplateModel, type CropStageTask, type CropStageTemplate } from '@models';
import { CROP_CODES, CROP_GROWING_DAYS, type CropCode, type Locale } from '@shared';

import { templateFor } from '../modules/calendar/cropCalendar.templates';

/**
 * Seed for `cropStageTemplates` — the growth stages of every supported crop.
 *
 * **The agronomy lives in this file and nowhere else.** Not inlined in the
 * model, which describes a shape rather than a season, and not in the route,
 * which would make correcting a top-dressing day a change to request handling.
 * `server/src/data/crop-calendar-templates.json` holds the same numbers as a
 * flat list for Day 11's generator; this file groups them into stages, and
 * {@link assertAgreesWithDay11Templates} refuses to run if the two have
 * drifted — so a day corrected in one and not the other is caught here rather
 * than by a farmer whose calendar disagrees with their stage bar.
 *
 * It ships **unreviewed**, on the same terms as the JSON file. Every
 * `startOffsetDays`, `durationDays` and `isCritical` below is indicative
 * dry-zone (Anuradhapura/Polonnaruwa) timing compiled from general DOA
 * guidance, and needs an agronomist to confirm or correct it before release.
 *
 * **Idempotent by construction.** The upsert key is `cropId` +
 * `stageName.en`, which is the collection's one unique index, and a row whose
 * stored agronomy already matches is left completely alone — not rewritten
 * with identical values, because that would churn `version` on every deploy
 * and make "which revision generated this calendar" meaningless.
 *
 * Run it with `npm run seed:templates --workspace server`.
 */

/* -------------------------------------------------------------------------- */
/* Data                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One stage, before it has an `_id`.
 *
 * `version` is absent too: the seed owns it, starting at 1 and incrementing
 * only when the agronomy in a row actually changes.
 */
type StageSeed = Omit<CropStageTemplate, '_id' | 'version' | 'createdAt' | 'updatedAt'>;

/** Shorthand, so a stage's three names read as one line rather than four. */
function name(en: string, ta: string, si: string): Locale {
  return { en, ta, si };
}

/**
 * Shorthand for a task.
 *
 * `offsetDays` is from the **sowing date**, not from the start of the stage —
 * see `cropStageTemplate.model`. Written that way here so the numbers below
 * can be read straight against `crop-calendar-templates.json`, which is what
 * makes the cross-check at the bottom of this file possible at all.
 */
function task(
  offsetDays: number,
  taskType: CropStageTask['taskType'],
  titleKey: string,
  isCritical = false,
): CropStageTask {
  return { offsetDays, taskType, titleKey, isCritical };
}

/**
 * `isCritical` marks work that decides the season rather than improves it: the
 * planting itself, the herbicide window before the weeds set seed, the
 * dressing that sets grain number, the scouting round for the pest that takes
 * a whole field. Ordinary irrigation and follow-up dressings are not critical
 * — a farmer who does those a few days late still has a crop.
 */
const PADDY: StageSeed[] = [
  {
    cropId: 'PADDY',
    stageName: name('Establishment', 'நிலைப்படுத்தல்', 'පිහිටුවීම'),
    startOffsetDays: 0,
    durationDays: 14,
    tasks: [
      task(0, 'sowing', 'calendar.task.paddy.sowing.title', true),
      task(3, 'irrigation', 'calendar.task.paddy.establishWater.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'PADDY',
    stageName: name('Tillering', 'பிள்ளை பிடித்தல்', 'අතු ඇරීම'),
    startOffsetDays: 14,
    durationDays: 26,
    tasks: [
      task(14, 'fertilising', 'calendar.task.paddy.topDressing1.title', true),
      task(21, 'weeding', 'calendar.task.paddy.weeding1.title', true),
      task(30, 'pest_control', 'calendar.task.paddy.pestScout1.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'PADDY',
    stageName: name('Panicle initiation', 'கதிர் உருவாக்கம்', 'කරල් ඇරඹීම'),
    startOffsetDays: 40,
    durationDays: 25,
    tasks: [
      task(40, 'fertilising', 'calendar.task.paddy.topDressing2.title'),
      task(50, 'irrigation', 'calendar.task.paddy.midSeasonWater.title'),
      task(60, 'pest_control', 'calendar.task.paddy.pestScout2.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'PADDY',
    stageName: name('Flowering', 'பூத்தல்', 'මල් පිපීම'),
    startOffsetDays: 65,
    durationDays: 30,
    tasks: [task(65, 'fertilising', 'calendar.task.paddy.panicleDressing.title', true)],
    isActive: true,
  },
  {
    cropId: 'PADDY',
    stageName: name('Ripening', 'கனிதல்', 'මේරීම'),
    startOffsetDays: 95,
    durationDays: 25,
    tasks: [
      task(105, 'irrigation', 'calendar.task.paddy.drainField.title', true),
      task(115, 'harvest', 'calendar.task.paddy.harvest.title', true),
    ],
    isActive: true,
  },
];

const TOMATO: StageSeed[] = [
  {
    cropId: 'TOMATO',
    stageName: name('Establishment', 'நிலைப்படுத்தல்', 'පිහිටුවීම'),
    startOffsetDays: 0,
    durationDays: 14,
    tasks: [
      task(0, 'sowing', 'calendar.task.tomato.transplant.title', true),
      task(7, 'irrigation', 'calendar.task.tomato.establishWater.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'TOMATO',
    stageName: name('Vegetative growth', 'தாவர வளர்ச்சி', 'වර්ධන අවධිය'),
    startOffsetDays: 14,
    durationDays: 21,
    tasks: [
      task(14, 'fertilising', 'calendar.task.tomato.topDressing1.title', true),
      task(21, 'weeding', 'calendar.task.tomato.weeding1.title', true),
      task(28, 'pest_control', 'calendar.task.tomato.whitefly.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'TOMATO',
    stageName: name('Flowering', 'பூத்தல்', 'මල් පිපීම'),
    startOffsetDays: 35,
    durationDays: 20,
    tasks: [
      task(35, 'fertilising', 'calendar.task.tomato.topDressing2.title'),
      task(45, 'pest_control', 'calendar.task.tomato.fruitBorer.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'TOMATO',
    stageName: name('Fruiting', 'காய் பிடித்தல்', 'ගෙඩි හැදීම'),
    startOffsetDays: 55,
    durationDays: 10,
    tasks: [task(55, 'fertilising', 'calendar.task.tomato.topDressing3.title')],
    isActive: true,
  },
  {
    cropId: 'TOMATO',
    stageName: name('Harvest', 'அறுவடை', 'අස්වනු නෙළීම'),
    startOffsetDays: 65,
    durationDays: 35,
    tasks: [
      task(65, 'harvest', 'calendar.task.tomato.firstPicking.title', true),
      task(90, 'harvest', 'calendar.task.tomato.finalPicking.title'),
    ],
    isActive: true,
  },
];

const CHILLI: StageSeed[] = [
  {
    cropId: 'CHILLI',
    stageName: name('Establishment', 'நிலைப்படுத்தல்', 'පිහිටුවීම'),
    startOffsetDays: 0,
    durationDays: 15,
    tasks: [
      task(0, 'sowing', 'calendar.task.chilli.transplant.title', true),
      task(7, 'irrigation', 'calendar.task.chilli.establishWater.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'CHILLI',
    stageName: name('Vegetative growth', 'தாவர வளர்ச்சி', 'වර්ධන අවධිය'),
    startOffsetDays: 15,
    durationDays: 20,
    tasks: [
      task(15, 'fertilising', 'calendar.task.chilli.topDressing1.title', true),
      task(25, 'weeding', 'calendar.task.chilli.weeding1.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'CHILLI',
    stageName: name('Flowering', 'பூத்தல்', 'මල් පිපීම'),
    startOffsetDays: 35,
    durationDays: 25,
    tasks: [
      task(35, 'pest_control', 'calendar.task.chilli.thrips.title', true),
      task(45, 'fertilising', 'calendar.task.chilli.topDressing2.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'CHILLI',
    stageName: name('Fruiting', 'காய் பிடித்தல்', 'ගෙඩි හැදීම'),
    startOffsetDays: 60,
    durationDays: 30,
    tasks: [
      task(60, 'pest_control', 'calendar.task.chilli.anthracnose.title', true),
      task(75, 'fertilising', 'calendar.task.chilli.topDressing3.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'CHILLI',
    stageName: name('Harvest', 'அறுவடை', 'අස්වනු නෙළීම'),
    startOffsetDays: 90,
    durationDays: 40,
    tasks: [
      task(90, 'harvest', 'calendar.task.chilli.firstPicking.title', true),
      task(120, 'harvest', 'calendar.task.chilli.finalPicking.title'),
    ],
    isActive: true,
  },
];

const ONION: StageSeed[] = [
  {
    cropId: 'ONION',
    stageName: name('Establishment', 'நிலைப்படுத்தல்', 'පිහිටුවීම'),
    startOffsetDays: 0,
    durationDays: 15,
    tasks: [
      task(0, 'sowing', 'calendar.task.onion.planting.title', true),
      task(5, 'irrigation', 'calendar.task.onion.establishWater.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'ONION',
    stageName: name('Vegetative growth', 'தாவர வளர்ச்சி', 'වර්ධන අවධිය'),
    startOffsetDays: 15,
    durationDays: 20,
    tasks: [
      task(15, 'fertilising', 'calendar.task.onion.topDressing1.title', true),
      task(25, 'weeding', 'calendar.task.onion.weeding1.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'ONION',
    stageName: name('Bulb initiation', 'கிழங்கு உருவாக்கம்', 'අල ඇරඹීම'),
    startOffsetDays: 35,
    durationDays: 20,
    tasks: [
      task(35, 'pest_control', 'calendar.task.onion.thrips.title', true),
      task(45, 'fertilising', 'calendar.task.onion.topDressing2.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'ONION',
    stageName: name('Bulb development', 'கிழங்கு வளர்ச்சி', 'අල වර්ධනය'),
    startOffsetDays: 55,
    durationDays: 35,
    tasks: [
      task(55, 'irrigation', 'calendar.task.onion.bulbingWater.title', true),
      task(70, 'pest_control', 'calendar.task.onion.purpleBlotch.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'ONION',
    stageName: name('Maturity', 'முதிர்ச்சி', 'පරිණත වීම'),
    startOffsetDays: 90,
    durationDays: 5,
    tasks: [task(90, 'harvest', 'calendar.task.onion.harvest.title', true)],
    isActive: true,
  },
];

const BRINJAL: StageSeed[] = [
  {
    cropId: 'BRINJAL',
    stageName: name('Establishment', 'நிலைப்படுத்தல்', 'පිහිටුවීම'),
    startOffsetDays: 0,
    durationDays: 15,
    tasks: [
      task(0, 'sowing', 'calendar.task.brinjal.transplant.title', true),
      task(7, 'irrigation', 'calendar.task.brinjal.establishWater.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'BRINJAL',
    stageName: name('Vegetative growth', 'தாவர வளர்ச்சி', 'වර්ධන අවධිය'),
    startOffsetDays: 15,
    durationDays: 20,
    tasks: [
      task(15, 'fertilising', 'calendar.task.brinjal.topDressing1.title', true),
      task(25, 'weeding', 'calendar.task.brinjal.weeding1.title', true),
    ],
    isActive: true,
  },
  {
    cropId: 'BRINJAL',
    stageName: name('Flowering', 'பூத்தல்', 'මල් පිපීම'),
    startOffsetDays: 35,
    durationDays: 25,
    tasks: [
      task(35, 'pest_control', 'calendar.task.brinjal.shootBorer.title', true),
      task(45, 'fertilising', 'calendar.task.brinjal.topDressing2.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'BRINJAL',
    stageName: name('Fruiting', 'காய் பிடித்தல்', 'ගෙඩි හැදීම'),
    startOffsetDays: 60,
    durationDays: 25,
    tasks: [
      task(60, 'pest_control', 'calendar.task.brinjal.fruitBorer.title', true),
      task(75, 'fertilising', 'calendar.task.brinjal.topDressing3.title'),
    ],
    isActive: true,
  },
  {
    cropId: 'BRINJAL',
    stageName: name('Harvest', 'அறுவடை', 'අස්වනු නෙළීම'),
    startOffsetDays: 85,
    durationDays: 45,
    tasks: [
      task(85, 'harvest', 'calendar.task.brinjal.firstPicking.title', true),
      task(120, 'harvest', 'calendar.task.brinjal.finalPicking.title'),
    ],
    isActive: true,
  },
];

/** Every stage of every supported crop, in one list. */
export const CROP_STAGE_TEMPLATES: readonly StageSeed[] = [
  ...PADDY,
  ...TOMATO,
  ...CHILLI,
  ...ONION,
  ...BRINJAL,
];

/* -------------------------------------------------------------------------- */
/* Consistency checks                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The stages of a crop must tile its season exactly: start at day 0, abut with
 * no gap and no overlap, and end on `CROP_GROWING_DAYS`.
 *
 * A gap is a stretch of the season the client's stage bar cannot label, and an
 * overlap puts a plot in two stages at once. Neither is visible by reading the
 * numbers above — they are five additions per crop — so they are checked.
 */
function assertStagesTileTheSeason(): void {
  for (const crop of CROP_CODES) {
    const stages = [...stagesFor(crop)].sort((a, b) => a.startOffsetDays - b.startOffsetDays);

    if (stages.length === 0) {
      throw new Error(`cropStageTemplates: ${crop} has no stages`);
    }
    let expected = 0;
    for (const stage of stages) {
      if (stage.startOffsetDays !== expected) {
        throw new Error(
          `cropStageTemplates: ${crop} "${stage.stageName.en}" starts on day ` +
            `${String(stage.startOffsetDays)}; the previous stage ends on ${String(expected)}`,
        );
      }
      expected = stage.startOffsetDays + stage.durationDays;
    }
    if (expected !== CROP_GROWING_DAYS[crop]) {
      throw new Error(
        `cropStageTemplates: ${crop} stages cover ${String(expected)} days, but ` +
          `CROP_GROWING_DAYS says ${String(CROP_GROWING_DAYS[crop])}`,
      );
    }
  }
}

/**
 * Every task must fall inside the stage that carries it, and the stages
 * together must carry exactly the activities Day 11's JSON already has.
 *
 * The second half is the one that matters. `crop-calendar-templates.json`
 * still drives `syncTemplateTasks`, so a farmer can hold a calendar generated
 * from one source and a stage bar drawn from the other. If a day is corrected
 * in the JSON and not here, the two disagree by a few days on one task — which
 * is invisible in testing and confusing in a field.
 */
function assertAgreesWithDay11Templates(): void {
  for (const crop of CROP_CODES) {
    const stages = stagesFor(crop);

    for (const stage of stages) {
      const end = stage.startOffsetDays + stage.durationDays;
      for (const item of stage.tasks) {
        if (item.offsetDays < stage.startOffsetDays || item.offsetDays >= end) {
          throw new Error(
            `cropStageTemplates: ${crop} "${item.titleKey}" is on day ` +
              `${String(item.offsetDays)}, outside its stage "${stage.stageName.en}" ` +
              `(${String(stage.startOffsetDays)}–${String(end - 1)})`,
          );
        }
      }
    }

    // `${dayOffset}:${type}:${titleKey}` on both sides, sorted, compared as
    // text: the message then names the activity that differs, rather than
    // saying only that two lists are not equal.
    const here = stages
      .flatMap((stage) => stage.tasks)
      .map((item) => `${String(item.offsetDays)}:${item.taskType}:${item.titleKey}`)
      .sort();
    const day11 = templateFor(crop)
      .activities.map(
        (activity) => `${String(activity.dayOffset)}:${activity.type}:${activity.titleKey}`,
      )
      .sort();

    const missing = day11.filter((entry) => !here.includes(entry));
    const extra = here.filter((entry) => !day11.includes(entry));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `cropStageTemplates: ${crop} has drifted from crop-calendar-templates.json — ` +
          `missing here: [${missing.join(', ')}]; not in the JSON: [${extra.join(', ')}]`,
      );
    }
  }
}

function stagesFor(crop: CropCode): StageSeed[] {
  return CROP_STAGE_TEMPLATES.filter((stage) => stage.cropId === crop);
}

/** Runs every check. Exported so a test can assert the data without a database. */
export function validateCropStageTemplates(): void {
  assertStagesTileTheSeason();
  assertAgreesWithDay11Templates();
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

export interface SeedReport {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Writes the stages above into `cropStageTemplates`, once.
 *
 * Idempotent on `cropId` + `stageName.en`, which is the collection's unique
 * index. Running it twice against an unchanged file writes nothing at all —
 * not even an identical `$set`, because that would touch `updatedAt` and
 * `version` on every deploy and destroy the one signal that says which
 * revision of the agronomy a plot's calendar came from.
 *
 * Nothing is ever deleted. A stage that is no longer wanted is deactivated by
 * hand: a calendar generated last season came from a row, and removing it
 * would make that calendar unexplainable.
 */
export async function seedCropStageTemplates(): Promise<SeedReport> {
  validateCropStageTemplates();

  const report: SeedReport = { inserted: 0, updated: 0, unchanged: 0 };

  for (const stage of CROP_STAGE_TEMPLATES) {
    const key = { cropId: stage.cropId, 'stageName.en': stage.stageName.en };
    const existing = await CropStageTemplateModel.findOne(key)
      .lean<CropStageTemplate | null>()
      .exec();

    if (!existing) {
      try {
        await CropStageTemplateModel.create({ _id: randomUUID(), version: 1, ...stage });
        report.inserted += 1;
        continue;
      } catch (error) {
        // Another seed inserted this row between the find and the create. The
        // unique index is what makes that a caught error rather than a
        // duplicate stage, and the right answer is to treat it as an update.
        if (!isDuplicateKey(error)) {
          throw error;
        }
      }
    } else if (!hasChanged(existing, stage)) {
      report.unchanged += 1;
      continue;
    }

    await CropStageTemplateModel.updateOne(key, { $set: stage, $inc: { version: 1 } }).exec();
    report.updated += 1;
  }

  return report;
}

/**
 * Whether the stored row's agronomy differs from the file's.
 *
 * Compared field by field rather than by serialising the whole document: the
 * stored one carries `_id`, `version` and the timestamps, which are the
 * server's and are not what "changed" means here.
 */
function hasChanged(stored: CropStageTemplate, next: StageSeed): boolean {
  return (
    stored.startOffsetDays !== next.startOffsetDays ||
    stored.durationDays !== next.durationDays ||
    stored.isActive !== next.isActive ||
    stored.stageName.ta !== next.stageName.ta ||
    stored.stageName.si !== next.stageName.si ||
    JSON.stringify(stored.tasks.map(taskKey)) !== JSON.stringify(next.tasks.map(taskKey))
  );
}

/** Field order fixed, so two equal task lists serialise identically. */
function taskKey(item: CropStageTask): unknown[] {
  return [item.offsetDays, item.taskType, item.titleKey, item.isCritical];
}

/** MongoDB's unique-index violation, narrowed without an `any` cast. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `npm run seed:templates`.
 *
 * Opens its own connection and closes it, so the script runs against any
 * environment's `MONGODB_URI` without the API server being up. The exit code
 * is what a CI step or a deploy hook reads: a validation failure in the data
 * above stops the run before anything is written.
 */
async function main(): Promise<void> {
  await connectDatabase();
  try {
    // Without this the unique index may not exist yet on a fresh database, and
    // the idempotency this script claims would rest on nothing.
    await CropStageTemplateModel.syncIndexes();

    const report = await seedCropStageTemplates();
    logger.info('Crop stage templates seeded', { ...report, total: CROP_STAGE_TEMPLATES.length });
  } finally {
    await disconnectDatabase();
  }
}

// `require.main` rather than an unconditional call: this module is imported by
// the generator and by tests, and importing it must not open a connection.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Crop stage template seed failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
