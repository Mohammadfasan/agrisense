import { describe, expect, it } from 'vitest';

import { CropStageTemplateModel, type CropStageTemplate } from '@models';
import { CROP_CODES } from '@shared';

import {
  CROP_STAGE_TEMPLATES,
  seedCropStageTemplates,
  validateCropStageTemplates,
} from './cropStageTemplates';

/**
 * The seed has two jobs, and a bug in either is silent.
 *
 * The data has to be internally coherent — stages tiling the season, tasks
 * inside the stage that carries them, and the same activities Day 11's JSON
 * already generates. And the write has to be genuinely idempotent, which means
 * more than "does not crash on a second run": it must not touch `version`,
 * because that field is the only record of which revision of the agronomy a
 * plot's calendar came from, and a deploy that bumps it on every environment
 * makes it say nothing.
 */
describe('crop stage template data', () => {
  it('tiles every season and agrees with the Day 11 templates', () => {
    expect(() => {
      validateCropStageTemplates();
    }).not.toThrow();
  });

  it('covers all five crops in scope', () => {
    const covered = new Set(CROP_STAGE_TEMPLATES.map((stage) => stage.cropId));

    expect([...covered].sort()).toEqual([...CROP_CODES].sort());
  });

  it('gives every stage a name in all three languages', () => {
    for (const stage of CROP_STAGE_TEMPLATES) {
      expect(stage.stageName.en.length).toBeGreaterThan(0);
      expect(stage.stageName.ta.length).toBeGreaterThan(0);
      expect(stage.stageName.si.length).toBeGreaterThan(0);
    }
  });

  it('names no stage twice within a crop, which is what the upsert key assumes', () => {
    const keys = CROP_STAGE_TEMPLATES.map((stage) => `${stage.cropId}:${stage.stageName.en}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries i18n keys rather than sentences', () => {
    for (const stage of CROP_STAGE_TEMPLATES) {
      for (const task of stage.tasks) {
        expect(task.titleKey).toMatch(/^calendar\.task\.[a-z]+\.[A-Za-z0-9]+\.title$/);
      }
    }
  });
});

describe('seedCropStageTemplates', () => {
  it('inserts every stage on a fresh database', async () => {
    const report = await seedCropStageTemplates();

    expect(report.inserted).toBe(CROP_STAGE_TEMPLATES.length);
    expect(report.updated).toBe(0);
    expect(await CropStageTemplateModel.countDocuments()).toBe(CROP_STAGE_TEMPLATES.length);
  });

  it('writes nothing at all on a second run', async () => {
    await seedCropStageTemplates();
    const before = await CropStageTemplateModel.find().lean<CropStageTemplate[]>().exec();

    const report = await seedCropStageTemplates();

    expect(report).toEqual({
      inserted: 0,
      updated: 0,
      unchanged: CROP_STAGE_TEMPLATES.length,
    });
    // Ids, versions and `updatedAt` all survive untouched. The count alone
    // would pass even if every row had been rewritten in place.
    const after = await CropStageTemplateModel.find().lean<CropStageTemplate[]>().exec();
    expect(after).toEqual(before);
    expect(after.every((stage) => stage.version === 1)).toBe(true);
  });

  it('updates and bumps the version when the stored agronomy differs', async () => {
    await seedCropStageTemplates();
    const first = CROP_STAGE_TEMPLATES[0];
    if (!first) {
      throw new Error('no templates to seed');
    }
    const key = { cropId: first.cropId, 'stageName.en': first.stageName.en };
    // Stand in for an agronomist correcting a day in the file: change the
    // stored row instead, and the next seed must put it back.
    await CropStageTemplateModel.updateOne(key, { $set: { durationDays: 999 } }).exec();

    const report = await seedCropStageTemplates();

    expect(report.updated).toBe(1);
    expect(report.unchanged).toBe(CROP_STAGE_TEMPLATES.length - 1);
    const restored = await CropStageTemplateModel.findOne(key).lean<CropStageTemplate>().exec();
    expect(restored?.durationDays).toBe(first.durationDays);
    expect(restored?.version).toBe(2);
  });

  it('keeps the id stable across an update, so references to a stage survive', async () => {
    await seedCropStageTemplates();
    const first = CROP_STAGE_TEMPLATES[0];
    if (!first) {
      throw new Error('no templates to seed');
    }
    const key = { cropId: first.cropId, 'stageName.en': first.stageName.en };
    const before = await CropStageTemplateModel.findOne(key).lean<CropStageTemplate>().exec();

    await CropStageTemplateModel.updateOne(key, { $set: { isActive: false } }).exec();
    await seedCropStageTemplates();

    const after = await CropStageTemplateModel.findOne(key).lean<CropStageTemplate>().exec();
    expect(after?._id).toBe(before?._id);
    expect(after?.isActive).toBe(true);
  });

  it('refuses a duplicate stage name within a crop', async () => {
    await seedCropStageTemplates();
    const first = CROP_STAGE_TEMPLATES[0];
    if (!first) {
      throw new Error('no templates to seed');
    }

    await expect(
      CropStageTemplateModel.create({ ...first, _id: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
