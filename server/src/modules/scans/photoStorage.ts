import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '@shared';

import { EXTENSION, type ImageMimeType } from './imageType';

/**
 * Where scan photos live.
 *
 * `scan.service` depends only on this interface, so moving photos from local
 * disk to object storage (S3, R2) later is a new implementation and nothing
 * else. Tests use `LocalPhotoStorage` on a temporary directory.
 *
 * Keys are built here, from the scan's validated UUID and the current date,
 * and never taken from a request. `resolve` still checks every key against a
 * strict pattern and the root directory, because a key read back from the
 * database is only as trustworthy as whatever wrote it.
 */

export interface StoredPhoto {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

export interface PhotoStorage {
  save(scanId: string, data: Buffer, mimeType: ImageMimeType): Promise<StoredPhoto>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `scans/YYYY/MM/<uuid>.<ext>` and nothing else. */
const KEY_PATTERN = /^scans\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export class LocalPhotoStorage implements PhotoStorage {
  private readonly root: string;
  private readonly now: () => Date;

  /** `now` is injectable so tests can pin the dated folder. */
  constructor(root: string, now: () => Date = () => new Date()) {
    this.root = path.resolve(root);
    this.now = now;
  }

  async save(scanId: string, data: Buffer, mimeType: ImageMimeType): Promise<StoredPhoto> {
    const date = this.now();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    // Dated folders keep any one directory small; a flat folder of a million
    // files is slow to list and back up.
    const storageKey = `scans/${date.getUTCFullYear()}/${month}/${scanId}.${EXTENSION[mimeType]}`;
    const target = this.resolve(storageKey);

    await mkdir(path.dirname(target), { recursive: true });

    // Write to a temporary name, then rename. A crash mid-write leaves a
    // `.tmp` file, never a half-written photo under the real key.
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temp, data, { flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }

    return { storageKey, sizeBytes: data.length, sha256: sha256Hex(data) };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  /** Removing a photo that is already gone is not an error. */
  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  private resolve(storageKey: string): string {
    if (!KEY_PATTERN.test(storageKey)) {
      throw AppError.internal(`Refusing malformed photo storage key: ${storageKey}`);
    }
    const full = path.resolve(this.root, ...storageKey.split('/'));
    // Belt and braces: the pattern already forbids `..`, but the final path
    // must also be inside the root, whatever the pattern allowed.
    if (!full.startsWith(this.root + path.sep)) {
      throw AppError.internal(`Photo storage key escapes the upload directory: ${storageKey}`);
    }
    return full;
  }
}
