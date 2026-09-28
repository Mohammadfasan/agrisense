import { useEffect, useRef, type ReactElement } from 'react';

import type { ScanHeatmap } from '@/api/scans';

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

    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const smallContext = small.getContext('2d');
    if (!smallContext) {
      return;
    }

    const pixels = smallContext.createImageData(cols, rows);
    heatmap.grid.forEach((row, y) => {
      row.forEach((value, x) => {
        const i = (y * cols + x) * 4;
        const strength = value < THRESHOLD ? 0 : (value - THRESHOLD) / (1 - THRESHOLD);
        pixels.data[i] = 220; // red
        pixels.data[i + 1] = 38;
        pixels.data[i + 2] = 38;
        pixels.data[i + 3] = Math.round(strength * MAX_ALPHA);
      });
    });
    smallContext.putImageData(pixels, 0, 0);

    const [left, top, right, bottom] = heatmap.region;
    context.clearRect(0, 0, RESOLUTION, RESOLUTION);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      small,
      left * RESOLUTION,
      top * RESOLUTION,
      (right - left) * RESOLUTION,
      (bottom - top) * RESOLUTION,
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
