import { describe, expect, it, vi } from 'vitest';

import { createMlClient } from './mlClient';

const CONFIG = { url: 'http://ml.test', key: 'k'.repeat(40), timeoutMs: 1000 };
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const OK_BODY = {
  status: 'diagnosed',
  class_key: 'maize_common_rust',
  is_healthy: false,
  confidence: 0.98,
  required_confidence: 0.7,
  top: [
    { class_key: 'maize_common_rust', probability: 0.98 },
    { class_key: 'maize_healthy', probability: 0.01 },
    { class_key: 'tomato_late_blight', probability: 0.01 },
  ],
  heatmap: {
    grid: [
      [0, 0.5],
      [1, 0.2],
    ],
    region: [0.0625, 0.0625, 0.9375, 0.9375],
  },
  model_version: '1.0.0',
  inference_ms: 9.1,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake `fetch` that always answers with `response`. */
function answering(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

describe('mlClient', () => {
  it('turns a 200 into a decision, sending the key and the image field', async () => {
    const fetchMock = answering(json(200, OK_BODY));
    const client = createMlClient(CONFIG, fetchMock);

    const result = await client.diagnose(PHOTO, 'image/jpeg');

    expect(result.kind).toBe('decision');
    if (result.kind !== 'decision') return;
    expect(result.status).toBe('diagnosed');
    expect(result.diagnosis.classKey).toBe('maize_common_rust');
    expect(result.diagnosis.top).toHaveLength(3);
    expect(result.diagnosis.heatmap?.region).toEqual([0.0625, 0.0625, 0.9375, 0.9375]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://ml.test/v1/diagnose');
    expect((init?.headers as Record<string, string>)['X-Internal-Key']).toBe(CONFIG.key);
    expect((init?.body as FormData).get('image')).toBeInstanceOf(Blob);
  });

  it('passes an escalation through, with no heatmap for a healthy guess', async () => {
    const body = {
      ...OK_BODY,
      status: 'escalated',
      class_key: 'maize_healthy',
      is_healthy: true,
      confidence: 0.8,
      required_confidence: 0.9,
      heatmap: null,
    };
    const client = createMlClient(CONFIG, answering(json(200, body)));

    const result = await client.diagnose(PHOTO, 'image/jpeg');

    expect(result).toMatchObject({ kind: 'decision', status: 'escalated' });
    if (result.kind === 'decision') {
      expect(result.diagnosis.heatmap).toBeNull();
    }
  });

  it('turns a 400 into a rejection that carries the reason', async () => {
    const res = json(400, { detail: 'the image is too small (50x40); minimum 64px per side' });
    const client = createMlClient(CONFIG, answering(res));

    expect(await client.diagnose(PHOTO, 'image/jpeg')).toEqual({
      kind: 'rejected',
      reason: 'the image is too small (50x40); minimum 64px per side',
    });
  });

  it('treats a 200 that breaks the contract as unavailable, not as a result', async () => {
    const { class_key: _dropped, ...broken } = OK_BODY;
    const client = createMlClient(CONFIG, answering(json(200, broken)));

    const result = await client.diagnose(PHOTO, 'image/jpeg');

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toContain('class_key');
    }
  });

  it.each([401, 500, 503])(
    'treats HTTP %i as unavailable, so the scan is retried',
    async (status) => {
      const client = createMlClient(CONFIG, answering(json(status, { detail: 'nope' })));

      expect((await client.diagnose(PHOTO, 'image/jpeg')).kind).toBe('unavailable');
    },
  );

  it('treats a network failure as unavailable', async () => {
    const failing = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })),
    );
    const client = createMlClient(CONFIG, failing);

    const result = await client.diagnose(PHOTO, 'image/jpeg');

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toContain('ECONNREFUSED');
    }
  });

  it('gives up after the timeout', async () => {
    // Never answers on its own; only rejects when the client's timeout fires.
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out', 'TimeoutError'));
          });
        }),
    );
    const client = createMlClient({ ...CONFIG, timeoutMs: 50 }, hanging);

    const result = await client.diagnose(PHOTO, 'image/jpeg');

    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toContain('timed out');
    }
  });

  it('does not call ml-service at all without a key', async () => {
    const fetchMock = answering(json(200, OK_BODY));
    const client = createMlClient({ ...CONFIG, key: undefined }, fetchMock);

    expect((await client.diagnose(PHOTO, 'image/jpeg')).kind).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
