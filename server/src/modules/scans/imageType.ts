/**
 * What a photo's bytes say it is -- never what the client claims.
 *
 * The `Content-Type` of a multipart part and the file name are both chosen by
 * the sender, so neither is evidence. Every format we accept starts with a
 * fixed signature, and that is checked here before anything is stored.
 *
 * This is a gate, not a full validation: a file with a JPEG signature can
 * still be truncated or corrupt. ml-service decodes it properly and answers
 * 400 for those, which becomes a `rejected` scan.
 */

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const EXTENSION: Record<ImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(data: Buffer): ImageMimeType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
