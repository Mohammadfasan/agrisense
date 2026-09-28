import { z } from 'zod';

import type { ScanDiagnosis } from '@models';

import { EXTENSION, type ImageMimeType } from './imageType';

/**
 * Talks to ml-service `POST /v1/diagnose` and turns every possible answer into
 * one of three outcomes the scan service acts on:
 *
 *   decision     200            -> status `diagnosed` or `escalated`
 *   rejected     400, 413       -> status `rejected`; retrying cannot help,
 *                                  the farmer must retake the photo
 *   unavailable  anything else  -> status stays `pending`; the retry worker
 *                (401, 503, 5xx,   (Day 22 Part B) tries again later
 *                 timeout, network)
 *
 * A 401 is `unavailable`, not `rejected`: a wrong key is a configuration fault,
 * and the photo is fine. Once the key is fixed, the retry succeeds.
 *
 * The 200 body is validated too. ml-service is ours, but it is a separate
 * deployable with its own release cycle; if a field is ever renamed, this
 * fails loudly and keeps the scan pending instead of storing `undefined`.
 *
 * This module never throws for an ML problem -- every failure is a value.
 */

export type MlResult =
  | { kind: 'decision'; status: 'diagnosed' | 'escalated'; diagnosis: ScanDiagnosis }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable'; error: string };

export interface DiagnosisClient {
  diagnose(photo: Buffer, mimeType: ImageMimeType): Promise<MlResult>;
}

export interface MlClientConfig {
  url: string;
  key: string | undefined;
  timeoutMs: number;
}

/** `lastError` on the scan has a 500-character limit. */
const MAX_ERROR_LENGTH = 500;

const candidateSchema = z.object({
  class_key: z.string().min(1),
  probability: z.number().min(0).max(1),
});

const diagnoseResponseSchema = z.object({
  status: z.enum(['diagnosed', 'escalated']),
  class_key: z.string().min(1),
  is_healthy: z.boolean(),
  confidence: z.number().min(0).max(1),
  required_confidence: z.number().min(0).max(1),
  top: z.array(candidateSchema),
  heatmap: z
    .object({
      grid: z.array(z.array(z.number().min(0).max(1))),
      region: z.array(z.number().min(0).max(1)).length(4),
    })
    .nullable(),
  model_version: z.string().min(1),
  inference_ms: z.number().nonnegative(),
});

type DiagnoseResponse = z.infer<typeof diagnoseResponseSchema>;

const errorBodySchema = z.object({ detail: z.string() });

export function createMlClient(
  config: MlClientConfig,
  fetchImpl: typeof fetch = fetch,
): DiagnosisClient {
  return {
    async diagnose(photo, mimeType) {
      if (!config.key) {
        return unavailable('ML_SERVICE_KEY is not configured');
      }

      const form = new FormData();
      form.append(
        'image',
        new Blob([new Uint8Array(photo)], { type: mimeType }),
        `scan.${EXTENSION[mimeType]}`,
      );

      let response: Response;
      try {
        response = await fetchImpl(`${config.url}/v1/diagnose`, {
          method: 'POST',
          headers: { 'X-Internal-Key': config.key },
          body: form,
          // Without a timeout, a hung ml-service would hold the farmer's
          // request open until the phone gives up.
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        return unavailable(
          isTimeout(error)
            ? `ml-service timed out after ${config.timeoutMs} ms`
            : `ml-service unreachable: ${describe(error)}`,
        );
      }

      return interpret(response);
    },
  };
}

async function interpret(response: Response): Promise<MlResult> {
  const body: unknown = await response.json().catch(() => null);

  if (response.status === 200) {
    const parsed = diagnoseResponseSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return unavailable(
        `ml-service broke the response contract at "${issue?.path.join('.') ?? '?'}": ${issue?.message ?? 'invalid'}`,
      );
    }
    return { kind: 'decision', status: parsed.data.status, diagnosis: toDiagnosis(parsed.data) };
  }

  const errorBody = errorBodySchema.safeParse(body);
  const detail = errorBody.success ? errorBody.data.detail : `HTTP ${response.status}`;

  if (response.status === 400 || response.status === 413) {
    return { kind: 'rejected', reason: detail };
  }
  return unavailable(`ml-service answered ${response.status}: ${detail}`);
}

/** snake_case over the wire, camelCase in the database. */
function toDiagnosis(body: DiagnoseResponse): ScanDiagnosis {
  return {
    classKey: body.class_key,
    isHealthy: body.is_healthy,
    confidence: body.confidence,
    requiredConfidence: body.required_confidence,
    top: body.top.map((c) => ({ classKey: c.class_key, probability: c.probability })),
    heatmap: body.heatmap ? { grid: body.heatmap.grid, region: body.heatmap.region } : null,
    modelVersion: body.model_version,
    inferenceMs: body.inference_ms,
    diagnosedAt: new Date(),
  };
}

function unavailable(error: string): MlResult {
  return { kind: 'unavailable', error: error.slice(0, MAX_ERROR_LENGTH) };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // Node's fetch hides the real reason (ECONNREFUSED, ...) in `cause`.
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
