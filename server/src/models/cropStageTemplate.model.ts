import { randomUUID } from 'node:crypto';

import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import { ACTIVITY_TYPES, CROP_CODES, type ActivityType, type CropCode, type Locale } from '@shared';

/**
 * `cropStageTemplates` — the agronomy, as rows rather than as a JSON file.
 *
 * One document is one growth stage of one crop: "PADDY, tillering, days 15–40,
 * and these four things to do in it". A plot's calendar is the stages for its
 * crop, laid end to end from the day it was sown.
 *
 * **This is reference data, so the `_id` is server-minted** — a UUID v4 rather
 * than an ObjectId. The convention in `docs/schema.md` gives ObjectIds to
 * everything the farmer does not author, and a UUID here is a deliberate
 * exception: these rows are seeded by `npm run seed:templates` into every
 * environment independently, and a stable id that the seed can compute rather
 * than discover is what lets a template be referenced across a dump, a restore
 * and a fresh developer laptop without the reference breaking. Nothing about
 * it is client-generated; no request body can set it.
 *
 * **Relationship to `crop-calendar-templates.json`.** The JSON file
 * (`cropCalendar.templates.ts`) is Day 11's flat list of activities per crop
 * and still drives `syncTemplateTasks`. This collection is the same agronomy
 * with the growth stage put back in, which is what the client needs to draw a
 * stage bar and what an agronomist needs to review a season one phase at a
 * time. The two are seeded from the same numbers; see
 * `server/src/seed/cropStageTemplates.ts`.
 *
 * **No text lives here, only keys.** `titleKey` is an i18n key for the same
 * reason `calendarTasks.title` is one on a template task: the server has no
 * business choosing which of three languages to write a farmer's calendar in,
 * and the farmer may switch language afterwards. `stageName` is the one
 * exception — a `Locale` object — because a stage name is displayed as-is by
 * anything reading this collection directly (the seed report, an admin view)
 * and there is no task record to carry a key on.
 */

/** Mirrors `plot.model` and `calendarTask.model`. Every id here is one of these. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * One thing to do inside a stage.
 *
 * **`offsetDays` is measured from the sowing date, not from the start of the
 * stage.** Both readings are defensible and only one can be right, so it is
 * stated here and asserted by the seed: a task at `offsetDays: 21` in a stage
 * running 15–40 falls on sowing + 21 days, which is day 6 of the stage. The
 * generator can then write `addDays(sowingDate, offsetDays)` with no stage
 * arithmetic in it, and a stage whose boundaries are corrected does not
 * silently move the tasks inside it.
 */
export interface CropStageTask {
  taskType: ActivityType;
  /** Whole days from the plot's sowing date. 0 is sowing day itself. */
  offsetDays: number;
  /** i18n key, e.g. `calendar.task.paddy.topDressing1.title`. Never a sentence. */
  titleKey: string;
  /**
   * Work that decides the season rather than merely improves it — the
   * herbicide window, the panicle-stage dressing. Carried so a client can rank
   * a crowded day and, in Week 9, so a reminder can be worth sending twice.
   * Nothing branches on it yet.
   */
  isCritical: boolean;
}

export interface CropStageTemplate {
  /** Server-minted UUID v4, lower case. Stable across seed runs. */
  _id: string;
  /**
   * The crop this stage belongs to, as a `CROP_CODES` value.
   *
   * A code and not an ObjectId into `crops`, matching `plots.crop`: the join
   * this collection is actually on is "the crop on the farmer's plot", and
   * that is a code. `docs/schema.md` §5 has why codes are the stable
   * identifier for a crop at all.
   */
  cropId: CropCode;
  /** Displayed as-is, so trilingual rather than an i18n key. */
  stageName: Locale;
  /** Whole days from the sowing date to the first day of this stage. */
  startOffsetDays: number;
  /** How many days the stage lasts. Stages may abut but should not overlap. */
  durationDays: number;
  tasks: CropStageTask[];
  /**
   * Whether the generator should use this stage.
   *
   * Reference data is never deleted — a calendar generated last season was
   * generated from a row, and removing it would make that calendar
   * unexplainable. A corrected stage is deactivated and a new one seeded.
   */
  isActive: boolean;
  /**
   * Bumped by the seed whenever the agronomy in a row actually changes, so a
   * client or a support ticket can say which revision of the calendar a plot
   * was generated from.
   */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CropStageTemplateDocument = HydratedDocument<CropStageTemplate>;

const localeSubSchema = new Schema<Locale>(
  {
    en: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    ta: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    si: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  },
  { _id: false },
);

const cropStageTaskSchema = new Schema<CropStageTask>(
  {
    taskType: { type: String, enum: ACTIVITY_TYPES, required: true },
    offsetDays: { type: Number, required: true, min: 0, max: 730 },
    titleKey: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    isCritical: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const cropStageTemplateSchema = new Schema<CropStageTemplate>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      match: [UUID_V4, 'template id must be a lower-case UUID v4'],
    },
    cropId: { type: String, enum: CROP_CODES, required: true },
    stageName: { type: localeSubSchema, required: true },
    startOffsetDays: { type: Number, required: true, min: 0, max: 730 },
    durationDays: { type: Number, required: true, min: 1, max: 730 },
    // An empty array is legal: a stage can be a phase of the season with
    // nothing to do in it, and forcing a filler task would be worse data.
    tasks: { type: [cropStageTaskSchema], required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
    version: { type: Number, required: true, default: 1, min: 1 },
  },
  { timestamps: true, collection: 'cropStageTemplates' },
);

// Declared here rather than on the paths, so every index for this collection
// is visible in one place.
//
// The generator's query, exactly: every stage for one crop, in season order.
// Equality field first, then the sort key, so the read walks the index and
// never sorts in memory.
cropStageTemplateSchema.index({ cropId: 1, startOffsetDays: 1 }, { name: 'crop_stage_order' });
// The seed's upsert key. Unique rather than a plain index because "idempotent"
// has to survive two seeds racing: without the constraint both would miss on
// the find and both would insert, and the crop would quietly grow a duplicate
// stage that the generator would then emit twice.
cropStageTemplateSchema.index(
  { cropId: 1, 'stageName.en': 1 },
  { name: 'crop_stage_name_unique', unique: true },
);

export const CropStageTemplateModel: Model<CropStageTemplate> = model<CropStageTemplate>(
  'CropStageTemplate',
  cropStageTemplateSchema,
);
