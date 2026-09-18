import type { PipelineStage } from 'mongoose';

import { CalendarTaskModel } from '@models';
import { toObjectId, type IsoDate } from '@shared';

import { addDays, todayInColombo } from '../../utils/dateString';

/**
 * `GET /calendar/today` — what a farmer is looking at when they open the app.
 *
 * **One aggregation, not a query per plot.** The obvious implementation reads
 * the tasks, collects the plot ids and then reads the plots — which is one
 * round trip per plot on the hottest screen in the product, and gets worse
 * exactly as a farmer adds land. The `$lookup` below does the join inside
 * MongoDB, against `plots._id`, so the whole screen is one round trip whatever
 * the farmer owns.
 *
 * **Buckets rather than one sorted list**, because the client renders three
 * headings. Handing it a flat list would make it re-derive the boundaries from
 * a "today" it computed itself — and a client and a server disagreeing about
 * what day it is at UTC+05:30 is the whole problem `domain/dates.ts` exists to
 * prevent. The server decides once, and echoes the day it decided on.
 *
 * The three are not symmetric, and the asymmetry is deliberate:
 *
 * - **overdue** — due before today and still `pending`. Unbounded backwards: a
 *   task due three weeks ago and never done is the most urgent thing a farmer
 *   owns, and a window that dropped it would hide a missed spray behind a
 *   clean screen.
 * - **today** — due today, *whatever* its status. A farmer who has ticked off
 *   this morning's work should still see it there; a bucket that emptied as
 *   they worked would read as though the day had been lost.
 * - **next7** — due in the following seven days and still `pending`. A plan,
 *   so only what is still outstanding belongs in it.
 */

export interface TodayBuckets {
  date: IsoDate;
  overdue: TodayTask[];
  today: TodayTask[];
  next7: TodayTask[];
}

/** A stored task plus the name of the plot it is on. */
export interface TodayTask {
  _id: string;
  plotId: string;
  plotName: string;
  type: string;
  title: string;
  dueDate: IsoDate;
  status: string;
  version: number;
}

/** How far ahead `next7` looks. Seven days, as the endpoint's name says. */
const LOOKAHEAD_DAYS = 7;

/**
 * The three buckets, for every live plot the caller owns.
 *
 * `date` comes from the client when it sends one, because the phone knows what
 * day it is where the farmer is standing; the fallback is today in Colombo
 * rather than today in UTC, which between 18:30 and midnight UTC is already a
 * different day.
 */
export async function today(
  userId: string,
  date: IsoDate = todayInColombo(),
): Promise<TodayBuckets> {
  const horizon = addDays(date, LOOKAHEAD_DAYS);

  const [result] = await CalendarTaskModel.aggregate<Omit<TodayBuckets, 'date'>>(
    pipeline(toObjectId(userId), date, horizon),
  ).exec();

  return {
    date,
    overdue: result?.overdue ?? [],
    today: result?.today ?? [],
    next7: result?.next7 ?? [],
  };
}

/**
 * The pipeline, as one value, so the explain plan in `docs/schema.md` and the
 * code that runs can never be two different things.
 *
 * Exported so the index test can run `explain()` over the very pipeline the
 * endpoint runs, and assert on the *winning* plan. An assertion that merely
 * searched the whole explain output for an index name would pass on a rejected
 * plan, which is how a query silently stops using the index it was built for.
 */
export function pipeline(
  userId: ReturnType<typeof toObjectId>,
  date: IsoDate,
  horizon: IsoDate,
): PipelineStage[] {
  return [
    {
      // Equality fields first, then the range: `explain()` serves this from
      // `owner_live_due` -- (userId, deletedAt, dueDate) -- as an IXSCAN
      // bounded at the horizon, with the `$or` applied as a residual filter on
      // the FETCH.
      //
      // The `$or` is why there is no `status` in that index. `today` wants
      // every status while the other two buckets want only `pending`, so one
      // branch leaves `status` unconstrained and the planner cannot use it as
      // a prefix. A `{ userId, deletedAt, status, dueDate }` index was built
      // and measured; it lost to `owner_live_due` in every rewriting of this
      // `$match`, so it was removed rather than carried. See
      // `calendarTask.model` and `docs/schema.md` §19.
      //
      // The upper bound applies to everything, so nothing past the horizon is
      // read. There is deliberately no lower bound: overdue is unbounded
      // backwards, because a task missed three weeks ago is still missed.
      $match: {
        userId,
        deletedAt: null,
        dueDate: { $lte: horizon },
        $or: [{ status: 'pending' }, { dueDate: date }],
      },
    },
    // Before the `$lookup`, so the join runs over the rows that survive rather
    // than over everything, and so the sort can still use the index.
    { $sort: { dueDate: 1, _id: 1 } },
    {
      // A sub-pipeline rather than `localField`/`foreignField`, because a task
      // on a plot the farmer has since deleted must not appear: the plot is
      // gone from `/plots`, and a task on it would be work on a field they
      // have said they no longer have. The lookup matches on `plots._id`, so
      // it is an index hit per distinct plot and not a scan.
      $lookup: {
        from: 'plots',
        let: { plot: '$plotId' },
        pipeline: [
          {
            $match: {
              $expr: { $and: [{ $eq: ['$_id', '$$plot'] }, { $eq: ['$deletedAt', null] }] },
            },
          },
          // The name and nothing else. A farmer reading "spray the upper
          // field" needs to know which field; they do not need its boundary
          // polygon, and one per task would dwarf the response.
          { $project: { _id: 0, name: 1 } },
        ],
        as: 'plot',
      },
    },
    // No `preserveNullAndEmptyArrays`: an empty `plot` means the plot is
    // deleted, and dropping the task is the intended behaviour rather than an
    // oversight.
    { $unwind: '$plot' },
    {
      $project: {
        _id: 1,
        plotId: 1,
        plotName: '$plot.name',
        type: 1,
        title: 1,
        notes: 1,
        dueDate: 1,
        completedOn: 1,
        status: 1,
        completedAt: 1,
        isUserEdited: 1,
        generationBatchId: 1,
        source: 1,
        version: 1,
      },
    },
    {
      // `$facet` rather than three queries: the rows are already in memory by
      // this point, so splitting them costs nothing and keeps this to the one
      // round trip the endpoint promises. The sort above is preserved inside
      // each branch.
      $facet: {
        overdue: [{ $match: { dueDate: { $lt: date }, status: 'pending' } }],
        today: [{ $match: { dueDate: date } }],
        next7: [{ $match: { dueDate: { $gt: date, $lte: horizon }, status: 'pending' } }],
      },
    },
  ];
}
