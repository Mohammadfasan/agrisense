import type { Types, UpdateQuery } from 'mongoose';

import { logger } from '@config';
import { PlotModel, ScanModel, type Plot, type Scan } from '@models';
import { AppError, ErrorCode, HttpStatus, toObjectId, type GeoPoint } from '@shared';

import { detectImageType, type ImageMimeType } from './imageType';
import type { DiagnosisClient, MlResult } from './mlClient';
import { sha256Hex, type PhotoStorage } from './photoStorage';

/**
 * Scan reads and writes.
 *
 * The same two rules as `plot.service` hold here: the owner is a parameter,
 * never a payload field, and ownership is part of every query. A scan that is
 * someone else's, deleted, or never existed is the same 404.
 *
 * A scan is written ONCE. `save` either creates it or recognises a replay of
 * the same upload; it never replaces the photo. After creation only the
 * diagnosis outcome changes it, through `diagnose`.
 *
 * Dependencies are passed in (`createScanService`), not imported, so tests can
 * use a temporary directory and a fake ML client.
 */

export interface ScanInput {
  plotId: string | null;
  capturedAt: Date;
  /** From the device. When absent and a plot is given, the plot's centroid is used. */
  location?: GeoPoint;
  photo: Buffer;
}

export interface SaveScanResult {
  scan: Scan;
  /** `true` when this call created the scan, for the 201/200 decision. */
  created: boolean;
}

export interface ScanServiceDeps {
  storage: PhotoStorage;
  ml: DiagnosisClient;
}

type PlotFacts = Pick<Plot, 'crop' | 'centroid'>;

export function createScanService({ storage, ml }: ScanServiceDeps) {
  /**
   * Creates the scan under the client's UUID, or recognises a replay of it.
   *
   * The existence check runs BEFORE the photo is written, across all owners:
   * otherwise an upload under another farmer's scan id could overwrite their
   * photo file before the insert failed. (A v4 UUID is unguessable and never
   * shown to other farmers, so this is defence in depth.)
   */
  async function save(userId: string, scanId: string, input: ScanInput): Promise<SaveScanResult> {
    const owner = toObjectId(userId);

    const mimeType = detectImageType(input.photo);
    if (!mimeType) {
      throw imageInvalid();
    }
    const sha256 = sha256Hex(input.photo);

    const existing = await ScanModel.findOne({ _id: scanId }).lean<Scan>().exec();
    if (existing) {
      return replay(existing, owner, sha256, input.photo);
    }

    const plot = input.plotId === null ? null : await ownedPlot(owner, input.plotId);
    const stored = await storage.save(scanId, input.photo, mimeType);

    let scan: Scan;
    try {
      const document = await ScanModel.create({
        _id: scanId,
        userId: owner,
        plotId: input.plotId,
        // Copied now: the plot may be replanted with another crop next season.
        crop: plot?.crop,
        location: input.location ?? plot?.centroid,
        capturedAt: input.capturedAt,
        photo: {
          storageKey: stored.storageKey,
          mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        },
      });
      scan = document.toObject();
    } catch (error) {
      // Two copies of the same upload racing each other: both passed the
      // existence check, one insert won. The loser treats it as a replay.
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const winner = await ScanModel.findOne({ _id: scanId }).lean<Scan>().exec();
      if (!winner) {
        throw error;
      }
      return replay(winner, owner, sha256, input.photo);
    }

    const decided = await diagnose(scan._id, input.photo);
    return { scan: decided ?? scan, created: true };
  }

  async function getById(userId: string, scanId: string): Promise<Scan> {
    const scan = await ScanModel.findOne({
      _id: scanId,
      userId: toObjectId(userId),
      deletedAt: null,
    })
      .lean<Scan>()
      .exec();

    if (!scan) {
      throw scanNotFound();
    }
    return scan;
  }

  /**
   * Asks ml-service about one pending scan and records the outcome.
   *
   * Used right after upload (with the photo already in memory) and by the
   * retry worker in Part B (reading the photo back from storage). Returns the
   * updated scan, or `null` when the scan is no longer pending -- already
   * decided by another caller, deleted, or gone.
   *
   * The update filter repeats `status: 'pending'`, so when the upload request
   * and the worker race on one scan, only the first outcome is written.
   */
  async function diagnose(scanId: string, photo?: Buffer): Promise<Scan | null> {
    const scan = await ScanModel.findOne({ _id: scanId, status: 'pending', deletedAt: null })
      .lean<Scan>()
      .exec();
    if (!scan) {
      return null;
    }

    const bytes = photo ?? (await storage.read(scan.photo.storageKey));
    // Stored by `save` from `detectImageType`, so it is one of the three.
    const result = await ml.diagnose(bytes, scan.photo.mimeType as ImageMimeType);

    if (result.kind === 'unavailable') {
      logger.warn('Scan diagnosis deferred', { scanId, error: result.error });
    }

    return ScanModel.findOneAndUpdate({ _id: scanId, status: 'pending' }, outcomeUpdate(result), {
      new: true,
      runValidators: true,
    })
      .lean<Scan>()
      .exec();
  }

  /**
   * The same scan id arrived again. Answers exactly what the first upload
   * would, without storing anything new.
   */
  async function replay(
    existing: Scan,
    owner: Types.ObjectId,
    sha256: string,
    photo: Buffer,
  ): Promise<SaveScanResult> {
    if (!existing.userId.equals(owner) || existing.deletedAt !== null) {
      throw scanNotFound();
    }
    if (existing.photo.sha256 !== sha256) {
      throw scanConflict();
    }
    // A replay of a scan that is still pending is a free retry of the diagnosis.
    if (existing.status === 'pending') {
      return { scan: (await diagnose(existing._id, photo)) ?? existing, created: false };
    }
    return { scan: existing, created: false };
  }

  return { save, getById, diagnose };
}

export type ScanService = ReturnType<typeof createScanService>;

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function ownedPlot(owner: Types.ObjectId, plotId: string): Promise<PlotFacts> {
  const plot = await PlotModel.findOne({ _id: plotId, userId: owner, deletedAt: null })
    .select('crop centroid')
    .lean<PlotFacts>()
    .exec();

  if (!plot) {
    throw new AppError('No plot with that id exists for this account', HttpStatus.NOT_FOUND, {
      code: ErrorCode.PLOT_NOT_FOUND,
    });
  }
  return plot;
}

/**
 * What each ML outcome does to a pending scan.
 *
 * `version` moves only when something the farmer can see changes. A deferred
 * attempt changes `attempts` and `lastError`, which are internal, so a device
 * holding this scan has nothing new to sync.
 */
function outcomeUpdate(result: MlResult): UpdateQuery<Scan> {
  switch (result.kind) {
    case 'decision':
      return {
        $set: { status: result.status, diagnosis: result.diagnosis, lastError: null },
        $inc: { attempts: 1, version: 1 },
      };
    case 'rejected':
      return {
        $set: { status: 'rejected', rejectReason: result.reason.slice(0, 300), lastError: null },
        $inc: { attempts: 1, version: 1 },
      };
    case 'unavailable':
      return { $set: { lastError: result.error }, $inc: { attempts: 1 } };
  }
}

function scanNotFound(): AppError {
  return new AppError('No scan with that id exists for this account', HttpStatus.NOT_FOUND, {
    code: ErrorCode.SCAN_NOT_FOUND,
  });
}

function scanConflict(): AppError {
  return new AppError(
    'A different photo was already uploaded under this scan id',
    HttpStatus.CONFLICT,
    { code: ErrorCode.SCAN_CONFLICT },
  );
}

function imageInvalid(): AppError {
  return new AppError(
    'The upload is not a JPEG, PNG or WebP photo',
    HttpStatus.UNPROCESSABLE_ENTITY,
    {
      code: ErrorCode.SCAN_IMAGE_INVALID,
    },
  );
}

/** MongoDB's unique-index violation, narrowed without an `any` cast. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
