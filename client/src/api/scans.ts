import { z } from 'zod';

import { api } from '@/shared/api/client';

/**
 * The Day 22 scan endpoints, as typed calls.
 *
 * Same arrangement as `api/calendar.ts`: plain functions, read through
 * react-query, every response parsed before it is returned. The shape mirrors
 * the server's FARMER view (`scan.presenter.ts`): when a scan is escalated,
 * `diagnosis` is null by the server's own rule, so this client cannot show a
 * diagnosis the model was not confident about even by mistake.
 *
 * The schema lives here for now. It belongs in `@agrisense/shared` next to
 * `plotSchema`, so the server's integration tests can parse its own responses
 * with it -- noted as tech debt for Week 6, when the offline store needs the
 * same shape.
 */

export const SCAN_STATUSES = ['pending', 'diagnosed', 'escalated', 'rejected'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

const heatmapSchema = z.object({
  /** rows x cols, 0..1; row 0 is the top of the photo. */
  grid: z.array(z.array(z.number().min(0).max(1))),
  /** [left, top, right, bottom] of the uploaded photo the grid covers, as fractions. */
  region: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const diagnosisSchema = z.object({
  classKey: z.string().min(1),
  isHealthy: z.boolean(),
  confidence: z.number().min(0).max(1),
  heatmap: heatmapSchema.nullable(),
  modelVersion: z.string(),
});

const scanSchema = z.object({
  _id: z.string().uuid(),
  plotId: z.string().nullable(),
  crop: z.string().nullable(),
  capturedAt: z.string(),
  status: z.enum(SCAN_STATUSES),
  diagnosis: diagnosisSchema.nullable(),
  rejectReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScanRecord = z.infer<typeof scanSchema>;
export type ScanDiagnosis = z.infer<typeof diagnosisSchema>;
export type ScanHeatmap = z.infer<typeof heatmapSchema>;

const scanResponseSchema = z.object({ scan: scanSchema });

/* -------------------------------------------------------------------------- */
/* Query keys                                                                  */
/* -------------------------------------------------------------------------- */

export const scanKeys = {
  all: ['scans'] as const,
  one: (scanId: string) => [...scanKeys.all, scanId] as const,
};

/* -------------------------------------------------------------------------- */
/* Error codes the scan screen branches on                                     */
/* -------------------------------------------------------------------------- */

export const SCAN_ERRORS = {
  imageInvalid: 'SCAN_IMAGE_INVALID',
  tooLarge: 'SCAN_PHOTO_TOO_LARGE',
  conflict: 'SCAN_CONFLICT',
  plotNotFound: 'PLOT_NOT_FOUND',
} as const;

/* -------------------------------------------------------------------------- */
/* Calls                                                                       */
/* -------------------------------------------------------------------------- */

export interface ScanUpload {
  /**
   * Minted ONCE, when the photo is taken, and reused on every retry. The
   * server is idempotent on this id: a retried upload lands on the scan the
   * first attempt created instead of making a second one.
   */
  id: string;
  photo: Blob;
  capturedAt: Date;
  plotId?: string | null;
  location?: { longitude: number; latitude: number };
}

export interface UploadedScan {
  scan: ScanRecord;
  /** `true` for 201 (this attempt created it), `false` for 200 (a replay). */
  created: boolean;
}

/**
 * `PUT /scans/:id`, multipart. The Content-Type is set explicitly below; see
 * the comment there for why the instance's JSON default must be overridden.
 */
export async function uploadScan(input: ScanUpload): Promise<UploadedScan> {
  const form = new FormData();
  form.append('photo', input.photo, 'scan.jpg');
  form.append('capturedAt', input.capturedAt.toISOString());
  if (input.plotId) {
    form.append('plotId', input.plotId);
  }
  if (input.location) {
    form.append('longitude', String(input.location.longitude));
    form.append('latitude', String(input.location.latitude));
  }

  const response = await api.put<unknown>(`/scans/${input.id}`, form, {
    // Overrides the instance's JSON default. With `application/json` still in
    // place, axios would serialise this FormData into a JSON object and the
    // photo would never leave the phone. In the browser axios then drops this
    // header again and lets the browser write it with the multipart boundary.
    headers: { 'Content-Type': 'multipart/form-data' },
    // A photo on rural 3G takes longer than a JSON call. The compressed photo
    // is ~100 KB, so this is generous, not optimistic.
    timeout: 60_000,
  });

  return {
    scan: scanResponseSchema.parse(response.data).scan,
    created: response.status === 201,
  };
}

export async function fetchScan(scanId: string): Promise<ScanRecord> {
  const { data } = await api.get<unknown>(`/scans/${scanId}`);

  return scanResponseSchema.parse(data).scan;
}
