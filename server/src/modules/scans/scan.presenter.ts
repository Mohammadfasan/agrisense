import type { Scan, ScanStatus } from '@models';
import type { CropCode } from '@shared/types';

/**
 * What a FARMER sees of a scan.
 *
 * The confidence ADR says: below the threshold, no diagnosis -- an officer
 * decides. The database keeps the model's full answer for every scan (officer
 * review and Week 9 drift monitoring need it), so the rule is enforced HERE,
 * on the way out. A bug in the client can then never show a farmer a
 * diagnosis the model was not confident about, because the client never
 * receives one.
 *
 * Also left out: the runner-up classes, the required confidence, attempts and
 * internal errors. None of it helps a farmer act, and some of it confuses.
 */

export interface FarmerScanDiagnosis {
  classKey: string;
  isHealthy: boolean;
  confidence: number;
  /** Only for diseases. */
  heatmap: { grid: number[][]; region: number[] } | null;
  modelVersion: string;
}

export interface FarmerScanView {
  _id: string;
  plotId: string | null;
  crop: CropCode | null;
  capturedAt: Date;
  status: ScanStatus;
  /** Only when `status` is `diagnosed`. */
  diagnosis: FarmerScanDiagnosis | null;
  /** Only when `status` is `rejected`. Safe to show: it says why to retake. */
  rejectReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toFarmerView(scan: Scan): FarmerScanView {
  const d = scan.diagnosis;
  return {
    _id: scan._id,
    plotId: scan.plotId,
    crop: scan.crop ?? null,
    capturedAt: scan.capturedAt,
    status: scan.status,
    diagnosis:
      scan.status === 'diagnosed' && d
        ? {
            classKey: d.classKey,
            isHealthy: d.isHealthy,
            confidence: d.confidence,
            heatmap: d.heatmap,
            modelVersion: d.modelVersion,
          }
        : null,
    rejectReason: scan.status === 'rejected' ? scan.rejectReason : null,
    version: scan.version,
    createdAt: scan.createdAt,
    updatedAt: scan.updatedAt,
  };
}
