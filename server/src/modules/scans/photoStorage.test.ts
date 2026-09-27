import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectImageType } from './imageType';
import { LocalPhotoStorage, sha256Hex } from './photoStorage';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg body')]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake png body'),
]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 body')]);
const SCAN_ID = '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f';

describe('detectImageType', () => {
  it('reads the type from the bytes', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(WEBP)).toBe('image/webp');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7 not a photo'))).toBeNull();
    expect(detectImageType(Buffer.from('MZ executable'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('LocalPhotoStorage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'agrisense-photos-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves under a dated key and reads the same bytes back', async () => {
    const storage = new LocalPhotoStorage(root, () => new Date('2026-09-27T04:30:00Z'));

    const stored = await storage.save(SCAN_ID, JPEG, 'image/jpeg');

    expect(stored.storageKey).toBe(`scans/2026/09/${SCAN_ID}.jpg`);
    expect(stored.sizeBytes).toBe(JPEG.length);
    expect(stored.sha256).toBe(sha256Hex(JPEG));
    expect(await storage.read(stored.storageKey)).toEqual(JPEG);
  });

  it('leaves no temporary files behind', async () => {
    const storage = new LocalPhotoStorage(root, () => new Date('2026-09-27T04:30:00Z'));
    await storage.save(SCAN_ID, PNG, 'image/png');

    expect(await readdir(path.join(root, 'scans', '2026', '09'))).toEqual([`${SCAN_ID}.png`]);
  });

  it('refuses keys that could escape the upload directory', async () => {
    const storage = new LocalPhotoStorage(root);

    await expect(storage.read('../../etc/passwd')).rejects.toThrow();
    await expect(storage.read(`scans/2026/09/../../../${SCAN_ID}.jpg`)).rejects.toThrow();
    await expect(storage.save('../escape', JPEG, 'image/jpeg')).rejects.toThrow();
  });

  it('treats removing a missing photo as done', async () => {
    const storage = new LocalPhotoStorage(root, () => new Date('2026-09-27T04:30:00Z'));
    const { storageKey } = await storage.save(SCAN_ID, JPEG, 'image/jpeg');

    await storage.remove(storageKey);
    await storage.remove(storageKey);

    await expect(storage.read(storageKey)).rejects.toThrow();
  });
});
