/**
 * Turns the phone camera's photo into what is uploaded: the centre square,
 * at most 512 x 512, as a JPEG.
 *
 * Why a square: the model was trained on photos resized to a square. A 4:3
 * phone photo reaching the server would be stretched to fit, distorting the
 * leaf. Cropping the centre square here means the server's resize never
 * stretches anything -- and the preview shows the farmer exactly what the
 * model will see.
 *
 * Why 512: the model looks at 224 x 224. 512 keeps detail for the resize and
 * the heatmap overlay while cutting a 3-6 MB photo to about 60-120 KB --
 * seconds instead of half a minute on rural 3G.
 *
 * Privacy, for free: drawing on a canvas and re-encoding drops ALL of the
 * original file's metadata, including the GPS position of wherever the photo
 * was taken (often the farmer's home) and the phone model.
 *
 * Orientation: browsers decode images upright (EXIF orientation applied) by
 * default, both through `createImageBitmap` and `<img>`. The `<img>` path is
 * the fallback for older WebViews that lack `createImageBitmap` for Blobs.
 */

export const OUTPUT_SIZE = 512;
/** A crop smaller than the model's input would be upscaled, adding nothing. */
export const MIN_SIDE = 224;
const JPEG_QUALITY = 0.85;

export type PhotoErrorReason = 'unreadable' | 'too_small';

export class PhotoError extends Error {
  readonly reason: PhotoErrorReason;

  constructor(reason: PhotoErrorReason) {
    super(`photo ${reason}`);
    this.name = 'PhotoError';
    this.reason = reason;
  }
}

export interface PreparedPhoto {
  blob: Blob;
  /** An object URL of `blob`. The caller revokes it when the screen is done with it. */
  previewUrl: string;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const image = await decode(file);
  try {
    const side = Math.min(image.width, image.height);
    if (side < MIN_SIDE) {
      throw new PhotoError('too_small');
    }

    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    const size = Math.min(OUTPUT_SIZE, side);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new PhotoError('unreadable');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, sx, sy, side, side, 0, 0, size, size);

    const blob = await toJpeg(canvas);
    return { blob, previewUrl: URL.createObjectURL(blob) };
  } finally {
    image.release();
  }
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => {
          bitmap.close();
        },
      };
    } catch {
      // Some WebViews expose the function but cannot decode a Blob with it.
      // Fall through to <img>.
    }
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError('unreadable');
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => {
      URL.revokeObjectURL(url);
    },
  };
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new PhotoError('unreadable'));
        }
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
