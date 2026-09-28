import { useEffect, useRef, type ReactElement } from 'react';

import type { ScanHeatmap } from '@/api/scans';

/**
 * Where the model looked, drawn over the photo.
 *
 * The server sends a tiny 7x7 grid (~300 bytes) instead of an image. It is
 * painted into a small canvas and drawn scaled up with smoothing on, which
 * blends the cells into soft blobs -- the same bilinear upsampling Grad-CAM
 * figures use.
 *
 * The grid is padded with a transparent ring of cells before scaling. Without
 * it, a hot cell on the grid's edge (a diseased leaf margin) is cut off in a
 * hard straight line where the grid ends; with it, smoothing fades it out.
 *
 * Only the hotspots show: values below 0.35 are transparent. A photo washed
 * faint red all over tells a farmer nothing.
 *
 * `region` places the grid on the photo. The model saw the centre 224/256 of
 * the square we uploaded, so the grid covers [0.0625 .. 0.9375] of each side.
 */

const RESOLUTION = 512;
const THRESHOLD = 0.35;
const MAX_ALPHA = 190;

export function HeatmapOverlay({ heatmap }: { heatmap: ScanHeatmap }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const rows = heatmap.grid.length;
    const cols = heatmap.grid[0]?.length ?? 0;
    if (!canvas || !context || rows === 0 || cols === 0) {
      return;
    }

    // One transparent cell of padding on every side.
    const padded = document.createElement('canvas');
    padded.width = cols + 2;
    padded.height = rows + 2;
    const paddedContext = padded.getContext('2d');
    if (!paddedContext) {
      return;
    }

    // New ImageData starts fully transparent, so the ring needs no drawing.
    const pixels = paddedContext.createImageData(cols + 2, rows + 2);
    heatmap.grid.forEach((row, y) => {
      row.forEach((value, x) => {
        const i = ((y + 1) * (cols + 2) + (x + 1)) * 4;
        const strength = value < THRESHOLD ? 0 : (value - THRESHOLD) / (1 - THRESHOLD);
        pixels.data[i] = 220; // red
        pixels.data[i + 1] = 38;
        pixels.data[i + 2] = 38;
        pixels.data[i + 3] = Math.round(strength * MAX_ALPHA);
      });
    });
    paddedContext.putImageData(pixels, 0, 0);

    // The grid's own area, then grown by one cell each way for the padding.
    const [left, top, right, bottom] = heatmap.region;
    const cellWidth = ((right - left) * RESOLUTION) / cols;
    const cellHeight = ((bottom - top) * RESOLUTION) / rows;

    context.clearRect(0, 0, RESOLUTION, RESOLUTION);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      padded,
      left * RESOLUTION - cellWidth,
      top * RESOLUTION - cellHeight,
      (right - left) * RESOLUTION + 2 * cellWidth,
      (bottom - top) * RESOLUTION + 2 * cellHeight,
    );
  }, [heatmap]);

  return (
    <canvas
      ref={canvasRef}
      width={RESOLUTION}
      height={RESOLUTION}
      className="pointer-events-none absolute inset-0 h-full w-full rounded-xl"
      aria-hidden
    />
  );
}
