import { isoDateSchema, plotSchema, type PlotInput } from '@agrisense/shared';
import { z } from 'zod';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth';
import { newUuid } from '@/lib/uuid';
import { api, getApiErrorCode } from '@/shared/api/client';

/**
 * The farmer's plots, as this device currently understands them.
 *
 * Held in a store rather than fetched per screen because three screens read
 * the same list -- the card list and both ends of the form -- and a farmer
 * stepping from the list into an edit should not wait for the plot they were
 * just looking at to be fetched again.
 *
 * Nothing here is persisted. Offline plots are Week 6 work and belong in the
 * Dexie outbox (`client/src/db`), not in a second copy of the list that would
 * then have to be reconciled with it.
 */

/**
 * A plot as this client reads one.
 *
 * `plotSchema` is the shape the server validates *writes* with, and Day 12
 * added `sowingDate` to the record without adding it to the shared schema --
 * nothing the client may send sets it, because it is written by
 * `POST /plots/:plotId/calendar/generate` from what the farmer generated the
 * calendar with. The API does send it, and Zod strips what a schema does not
 * name, so parsing through `plotSchema` alone would quietly drop the one field
 * the plot detail header exists to show.
 *
 * Widened here rather than in `@agrisense/shared`: this is the read shape, and
 * the shared schema is what the server validates request bodies against.
 * `nullish`, because the field is absent on a plot made before Day 12 and
 * `null` on one whose calendar has never been generated.
 */
const plotRecordSchema = plotSchema.extend({ sowingDate: isoDateSchema.nullish() });

/**
 * Structurally the shared `PlotRecord` with one field more, so everything
 * already typed against that -- the form, the cards, `cropStage` -- takes one
 * of these unchanged.
 */
export type Plot = z.infer<typeof plotRecordSchema>;

/** What the API returns, checked against the schema the server validated with. */
const plotListResponseSchema = z.object({
  plots: z.array(plotRecordSchema),
  nextCursor: z.string().nullable(),
});

const plotResponseSchema = z.object({ plot: plotRecordSchema });

/**
 * How the list load went. `idle` is "nobody has asked yet", and it is what
 * lets {@link PlotState.ensureLoaded} tell a first visit from a return to a
 * list that is already there.
 */
export type PlotListStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PlotState {
  /** Newest first, in the server's own order. See {@link mergePlot}. */
  plots: Plot[];
  status: PlotListStatus;
  /**
   * The API's error code for a failed load, or `UNKNOWN` when the request
   * never got an answer. A code and not a sentence: the store has no business
   * holding a string in a language it cannot see, so `errors.ts` turns this
   * into one at render time.
   */
  error: string | null;
  /** Opaque, from the last page. `null` when the list is complete. */
  nextCursor: string | null;
  isLoadingMore: boolean;

  /** (Re)loads the first page. Never rejects; failure lands in `status`. */
  fetchPlots: () => Promise<void>;
  /** Loads the first page only if nothing has yet, for a screen's mount. */
  ensureLoaded: () => Promise<void>;
  /** Appends the next page, if there is one. Never rejects. */
  fetchMore: () => Promise<void>;
  /**
   * Fetches one plot, for a link opened straight into the form. Never
   * rejects: `missing` is the server's 404, which is a real answer a screen
   * has to show, and `error` is everything else.
   */
  fetchPlot: (id: string) => Promise<'ready' | 'missing' | 'error'>;
  /**
   * Creates a plot under an id minted here, before the request goes out.
   * Rejects with the API's error.
   */
  createPlot: (input: PlotInput) => Promise<Plot>;
  /** `PUT` — creates or replaces the whole plot. Rejects with the API's error. */
  savePlot: (id: string, input: PlotInput) => Promise<Plot>;
  /** Soft-deletes on the server and drops it here. Rejects with the API's error. */
  deletePlot: (id: string) => Promise<void>;
  /** Back to `idle`, with nothing loaded. */
  reset: () => void;
}

const EMPTY = {
  plots: [],
  status: 'idle' as PlotListStatus,
  error: null,
  nextCursor: null,
  isLoadingMore: false,
} satisfies Partial<PlotState>;

export const usePlotStore = create<PlotState>()((set, get) => ({
  ...EMPTY,

  fetchPlots: async () => {
    set({ status: 'loading', error: null });
    try {
      const page = await getPage(null);
      set({ plots: page.plots, nextCursor: page.nextCursor, status: 'ready', error: null });
    } catch (cause) {
      set({ status: 'error', error: getApiErrorCode(cause) ?? 'UNKNOWN' });
    }
  },

  ensureLoaded: async () => {
    // Deliberately not retried after a failure: the list screen offers a retry
    // button, and re-requesting on every mount would hammer a dead connection
    // every time the farmer stepped back to the list.
    if (get().status === 'idle') {
      await get().fetchPlots();
    }
  },

  fetchMore: async () => {
    const { nextCursor, isLoadingMore } = get();
    if (nextCursor === null || isLoadingMore) {
      return;
    }

    set({ isLoadingMore: true });
    try {
      const page = await getPage(nextCursor);
      // Merged rather than appended. A plot edited on this device has moved to
      // the front of the ordering since the cursor was issued, so it can come
      // back on a later page as well; appending would show it twice.
      set((state) => ({
        plots: page.plots.reduce(mergePlot, state.plots),
        nextCursor: page.nextCursor,
      }));
    } catch (cause) {
      // The pages already loaded are still good, so this does not throw the
      // whole list into `error` — only the cursor is spent.
      set({ error: getApiErrorCode(cause) ?? 'UNKNOWN' });
    } finally {
      set({ isLoadingMore: false });
    }
  },

  fetchPlot: async (id) => {
    try {
      const { data } = await api.get<unknown>(`/plots/${id}`);
      const { plot } = plotResponseSchema.parse(data);
      set((state) => ({ plots: mergePlot(state.plots, plot) }));
      return 'ready';
    } catch (cause) {
      return getApiErrorCode(cause) === 'PLOT_NOT_FOUND' ? 'missing' : 'error';
    }
  },

  createPlot: async (input) => {
    // The id exists before the request does, which is the whole point of ADR
    // 001: the plot has an address the moment it is thought of, so a `PUT`
    // replayed after a dropped connection lands on it rather than beside it.
    return get().savePlot(newUuid(), input);
  },

  savePlot: async (id, input) => {
    const { data } = await api.put<unknown>(`/plots/${id}`, input);
    const { plot } = plotResponseSchema.parse(data);
    set((state) => ({ plots: mergePlot(state.plots, plot) }));
    return plot;
  },

  deletePlot: async (id) => {
    await api.delete(`/plots/${id}`);
    set((state) => ({ plots: state.plots.filter((plot) => plot._id !== id) }));
  },

  reset: () => {
    set(EMPTY);
  },
}));

async function getPage(cursor: string | null): Promise<z.infer<typeof plotListResponseSchema>> {
  const { data } = await api.get<unknown>('/plots', {
    params: cursor === null ? {} : { cursor },
  });
  return plotListResponseSchema.parse(data);
}

/**
 * Inserts or replaces one plot, keeping `plots` in the order the API sorts it:
 * `updatedAt` descending, `_id` breaking a tie, exactly as `plot.service`
 * does it.
 *
 * Worth the few lines rather than unshifting. A saved plot really is the
 * newest and belongs at the front, but one fetched by id for a deep link does
 * not, and dropping that at the front would put the list in an order the next
 * page cursor disagrees with.
 */
function mergePlot(plots: readonly Plot[], plot: Plot): Plot[] {
  const rest = plots.filter((existing) => existing._id !== plot._id);
  const index = rest.findIndex((existing) => sortsBefore(plot, existing));
  const at = index === -1 ? rest.length : index;
  return [...rest.slice(0, at), plot, ...rest.slice(at)];
}

function sortsBefore(a: Plot, b: Plot): boolean {
  const difference = a.updatedAt.getTime() - b.updatedAt.getTime();
  return difference === 0 ? a._id > b._id : difference > 0;
}

// Plots belong to an account, not to a device. Without this, signing out and
// back in on a shared phone — which here is the normal case rather than the
// edge one — would show the previous farmer's plots until the next fetch
// landed.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    usePlotStore.getState().reset();
  }
});
