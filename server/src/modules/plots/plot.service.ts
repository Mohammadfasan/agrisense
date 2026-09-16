import type { FilterQuery, Types, UpdateQuery } from 'mongoose';

import { PlotModel, type Plot } from '@models';
import {
  AppError,
  ErrorCode,
  HttpStatus,
  polygonCentroid,
  toObjectId,
  type GeoPoint,
  type GeoPolygon,
  type PlotInput,
  type PlotListQuery,
  type PlotUpdateInput,
} from '@shared';

/**
 * Plot reads and writes.
 *
 * Two rules hold for every function in this module, and there is no path
 * through it that breaks either:
 *
 * 1. **The owner is a parameter, never a payload field.** Callers pass
 *    `req.user.id`; the input schemas have no `userId` at all.
 * 2. **Ownership is part of the query, not a check after it.** Every filter
 *    carries `userId`, so a plot belonging to someone else does not match.
 *    There is no `findById` here followed by an `if` -- that shape works until
 *    someone adds an early return above the `if`, and then it leaks.
 *
 * A plot that does not match, for any reason, produces the same 404. A farmer
 * probing another farmer's UUID cannot tell "not yours" from "does not exist",
 * which is why this is a 404 and not a 403.
 */

export interface SaveResult {
  plot: Plot;
  /** `true` when this call created the plot, for the 201/200 decision. */
  created: boolean;
}

export interface PlotPage {
  plots: Plot[];
  /** Opaque; passed back as `?cursor=` for the next page. `null` at the end. */
  nextCursor: string | null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One page of the caller's live plots, most recently updated first.
 *
 * `limit + 1` documents are fetched and the extra one dropped: it answers "is
 * there another page" without a second `countDocuments` over the same filter,
 * and without having to guess from a short page.
 */
export async function list(userId: string, query: PlotListQuery): Promise<PlotPage> {
  const filter: FilterQuery<Plot> = liveOwnedBy(toObjectId(userId));

  if (query.cursor !== undefined) {
    const after = decodeCursor(query.cursor);
    // The tie-break on `_id` is what makes the page boundary stable. Two plots
    // saved in the same millisecond share an `updatedAt`, and a cursor that
    // only said "older than this timestamp" would skip the second of them.
    filter.$or = [
      { updatedAt: { $lt: after.updatedAt } },
      { updatedAt: after.updatedAt, _id: { $lt: after.id } },
    ];
  }

  const documents = await PlotModel.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean<Plot[]>()
    .exec();

  const hasMore = documents.length > query.limit;
  const plots = hasMore ? documents.slice(0, query.limit) : documents;
  const last = plots[plots.length - 1];

  return { plots, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function getById(userId: string, plotId: string): Promise<Plot> {
  const plot = await PlotModel.findOne(liveOwnedBy(toObjectId(userId), plotId))
    .lean<Plot>()
    .exec();

  if (!plot) {
    throw plotNotFound();
  }
  return plot;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creates the plot under the client's own UUID, or replaces it if it is
 * already there. This is the endpoint offline sync replays into, so running it
 * twice with the same body has to leave exactly what running it once did.
 *
 * One atomic upsert, not a read followed by a write: two devices coming back
 * online together would both read "absent" and both insert, and the second
 * insert is the one that loses data. Here the second call matches the first
 * call's document and updates it.
 *
 * A replace, not a merge: `PUT` is defined on the whole resource, so a field
 * left out of the body goes back to its default rather than keeping the value
 * it had. {@link buildReplacement} spells that out.
 */
export async function save(userId: string, plotId: string, input: PlotInput): Promise<SaveResult> {
  const owner = toObjectId(userId);

  try {
    const result = await PlotModel.findOneAndUpdate(
      // `deletedAt: null` is in the filter not only for correctness but for
      // what it does to the insert: an upsert that matches nothing builds the
      // new document out of the filter's equality clauses, so `_id`, `userId`
      // and `deletedAt` all arrive from here and cannot come from a body.
      liveOwnedBy(owner, plotId),
      buildReplacement(input),
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        // Off because `version` has a schema default of 1 *and* is touched by
        // the `$inc` below. Left on, Mongoose would add
        // `$setOnInsert: { version: 1 }` and MongoDB would reject the whole
        // update as a path conflict. The `$inc` covers the insert on its own:
        // incrementing an absent field produces 1, which is that default. The
        // only other defaulted paths are `deletedAt`, which the filter
        // supplies, and `plantedAt` and `notes`, which the replacement sets.
        setDefaultsOnInsert: false,
        // Carries `lastErrorObject.upserted`, which is how a create is told
        // from a replace without a second query.
        includeResultMetadata: true,
        lean: true,
      },
    ).exec();

    return {
      plot: expectWritten(result.value),
      created: result.lastErrorObject?.upserted !== undefined,
    };
  } catch (error) {
    // The filter matched nothing, so MongoDB tried to insert -- and the `_id`
    // was already taken. Either another farmer owns that UUID, or this farmer
    // deleted it and the tombstone still holds the id. Both answer 404: the
    // first must not confirm that the id exists, and the second is the whole
    // point of a tombstone, which is that a deleted plot does not come back.
    if (isDuplicateKey(error)) {
      throw plotNotFound();
    }
    throw error;
  }
}

/**
 * Merges a partial body into an existing plot. Absent fields are left alone,
 * which is the whole difference from {@link save}.
 *
 * Never upserts: a `PATCH` names a resource that is supposed to exist, and
 * building one from a fragment would leave required fields unset. A patch
 * aimed at a plot that is missing, deleted or someone else's is a 404.
 */
export async function update(
  userId: string,
  plotId: string,
  patch: PlotUpdateInput,
): Promise<Plot> {
  const plot = await PlotModel.findOneAndUpdate(
    liveOwnedBy(toObjectId(userId), plotId),
    // Beyond the centroid the patch goes in as-is: Zod has already stripped
    // everything not in the schema, so no unknown path and no `$` operator
    // survives to reach here.
    { $set: withDerivedCentroid(patch), $inc: { version: 1 } },
    { new: true, runValidators: true },
  )
    .lean<Plot>()
    .exec();

  if (!plot) {
    throw plotNotFound();
  }
  return plot;
}

/**
 * Soft delete. The row stays, `deletedAt` is stamped, and the UUID stays
 * reserved -- a client replaying the create it made before it went offline
 * gets a 404 rather than resurrecting a plot the farmer meant to remove.
 *
 * `version` is bumped like any other write: to a device syncing later the
 * tombstone is simply the newest version of the plot, which is exactly how it
 * has to read for the delete to propagate at all.
 */
export async function softDelete(userId: string, plotId: string): Promise<void> {
  const result = await PlotModel.updateOne(liveOwnedBy(toObjectId(userId), plotId), {
    $set: { deletedAt: new Date() },
    $inc: { version: 1 },
  }).exec();

  // An already-deleted plot does not match, so a repeated DELETE is a 404
  // rather than a second tombstone overwriting the real deletion time.
  if (result.matchedCount === 0) {
    throw plotNotFound();
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The filter every read and write in this module starts from: owned by this
 * caller, not deleted, and -- when an id is given -- that exact plot.
 */
function liveOwnedBy(userId: Types.ObjectId, plotId?: string): FilterQuery<Plot> {
  return plotId === undefined
    ? { userId, deletedAt: null }
    : { _id: plotId, userId, deletedAt: null };
}

/**
 * The full-replacement update for `PUT`.
 *
 * `boundary` is `$unset` rather than set to `null`, because it is a
 * subdocument and a null one would fail the schema. `plantedAt` and `notes`
 * are nullable and go to `null`, which keeps the field visible in the response
 * instead of making a client tell "cleared" from "never set" by its absence.
 */
function buildReplacement(input: PlotInput): UpdateQuery<Plot> {
  const { boundary, plantedAt, notes, ...rest } = input;

  const update: UpdateQuery<Plot> = {
    $set: {
      ...rest,
      centroid: resolveCentroid(input.centroid, boundary),
      plantedAt: plantedAt ?? null,
      notes: notes ?? null,
      ...(boundary ? { boundary } : {}),
    },
    $inc: { version: 1 },
  };

  if (!boundary) {
    update.$unset = { boundary: '' };
  }
  return update;
}

/**
 * Fills in the centroid a `PATCH` implies but does not state.
 *
 * Redrawing a boundary moves the plot. If the patch said nothing about the
 * centroid, the old one would survive the new outline and the plot would sit
 * at the wrong place on the outbreak map -- silently, because nothing about
 * the request looks wrong.
 */
function withDerivedCentroid(patch: PlotUpdateInput): PlotUpdateInput {
  if (!patch.boundary || patch.centroid) {
    return patch;
  }
  return { ...patch, centroid: polygonCentroid(patch.boundary) };
}

/**
 * The centroid the client sent, or the one its boundary implies.
 *
 * This lives here rather than in the controller because it is a fact about
 * what a plot *is* -- it always has a point -- not about how the request was
 * shaped. The sync endpoint in Week 6 writes through the same function and
 * gets the same answer without restating the rule.
 *
 * `plotCreateSchema` guarantees at least one of the two is present, so the
 * throw is a defect guard rather than a reachable request path.
 */
function resolveCentroid(
  centroid: GeoPoint | undefined,
  boundary: GeoPolygon | undefined,
): GeoPoint {
  if (centroid) {
    return centroid;
  }
  if (boundary) {
    return polygonCentroid(boundary);
  }
  throw AppError.internal('Plot reached the service with neither a centroid nor a boundary');
}

/**
 * The paging cursor: the sort key of the last row served, base64url'd.
 *
 * Encoded rather than exposed as two query parameters, so that changing the
 * sort order later does not break every client that had learned to build one
 * by hand.
 */
function encodeCursor(plot: Plot): string {
  return Buffer.from(`${plot.updatedAt.toISOString()}|${plot._id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  const [timestamp, id, ...extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const updatedAt = timestamp === undefined ? new Date(Number.NaN) : new Date(timestamp);

  if (extra.length > 0 || !id || Number.isNaN(updatedAt.getTime())) {
    // A cursor is always something this server issued, so a malformed one is
    // a client that built its own or corrupted the one it was given. Saying so
    // beats silently serving page one again.
    throw AppError.validation('Invalid plot list cursor', [
      { path: 'cursor', message: 'must be a cursor returned by a previous page' },
    ]);
  }
  return { updatedAt, id };
}

function plotNotFound(): AppError {
  return new AppError('No plot with that id exists for this account', HttpStatus.NOT_FOUND, {
    code: ErrorCode.PLOT_NOT_FOUND,
  });
}

/** MongoDB's unique-index violation, narrowed without an `any` cast. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * An upsert that reports neither a document nor an error has no benign
 * reading, so it fails loudly rather than returning a half-saved plot.
 */
function expectWritten(value: Plot | null): Plot {
  if (!value) {
    throw AppError.internal('Plot upsert returned no document');
  }
  return value;
}
