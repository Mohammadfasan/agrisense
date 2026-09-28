import {
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  Leaf,
  RotateCcw,
  ScanLine,
  UserRound,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ScanDiagnosis, ScanRecord } from '@/api/scans';
import { Button, ErrorState, Spinner } from '@/shared/components';

import { adviceSteps, diseaseName, likelihoodLabel, urgencyOf } from './diseases';
import { HeatmapOverlay } from './HeatmapOverlay';
import { useScanResult } from './useScanResult';

/**
 * The outcome of one scan.
 *
 * - diagnosed, disease: the name in the farmer's language, how likely (in
 *   words), where on the leaf, and what to do -- with an urgent banner for
 *   diseases that spread fast.
 * - diagnosed, healthy: reassurance, and when to scan again.
 * - escalated: no diagnosis (the server already withheld it); an officer will look.
 * - rejected: why, and a retake as the main action.
 * - pending: checking, with polling; after two minutes, "come back later".
 */
export function ScanResultView({
  scanId,
  photoUrl,
  onScanAgain,
}: {
  scanId: string;
  photoUrl: string;
  onScanAgain: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { query, gaveUpWaiting } = useScanResult(scanId);
  const [showHeatmap, setShowHeatmap] = useState(true);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        description={t('scan.error.load', 'The result could not be loaded.')}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const scan = query.data;
  const heatmap = scan.status === 'diagnosed' ? (scan.diagnosis?.heatmap ?? null) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="relative">
        <img
          src={photoUrl}
          alt={
            heatmap && showHeatmap
              ? t('scan.photo.altHeatmap', 'The photo, with the damaged area highlighted in red')
              : t('scan.photo.alt', 'The photo that was checked')
          }
          className="aspect-square w-full rounded-xl object-cover"
        />
        {heatmap && showHeatmap && <HeatmapOverlay heatmap={heatmap} />}
      </div>

      {heatmap && (
        <Button
          variant="secondary"
          className="min-h-touch-md w-full text-base"
          onClick={() => {
            setShowHeatmap((shown) => !shown);
          }}
        >
          {showHeatmap ? (
            <EyeOff className="h-5 w-5" aria-hidden />
          ) : (
            <Eye className="h-5 w-5" aria-hidden />
          )}
          {showHeatmap
            ? t('scan.heatmap.hide', 'Hide the highlighted area')
            : t('scan.heatmap.show', 'Show where the damage is')}
        </Button>
      )}

      <Outcome scan={scan} gaveUpWaiting={gaveUpWaiting} />

      <Button
        variant={scan.status === 'rejected' ? 'primary' : 'secondary'}
        className="min-h-touch-lg w-full text-base"
        onClick={onScanAgain}
      >
        {scan.status === 'rejected' ? (
          <RotateCcw className="h-6 w-6" aria-hidden />
        ) : (
          <ScanLine className="h-6 w-6" aria-hidden />
        )}
        {scan.status === 'rejected'
          ? t('scan.retake', 'Take the photo again')
          : t('scan.again', 'Scan another leaf')}
      </Button>
    </section>
  );
}

function Outcome({
  scan,
  gaveUpWaiting,
}: {
  scan: ScanRecord;
  gaveUpWaiting: boolean;
}): ReactElement {
  const { t } = useTranslation();

  switch (scan.status) {
    case 'pending':
      return (
        <div className="flex items-start gap-3 rounded-xl bg-muted-50 p-4" role="status">
          {gaveUpWaiting ? (
            <Clock className="h-6 w-6 shrink-0 text-muted-700" aria-hidden />
          ) : (
            <Spinner size="md" />
          )}
          <p className="text-base text-gray-900">
            {gaveUpWaiting
              ? t(
                  'scan.pending.later',
                  'Still being checked. The result will be saved with this scan — you can come back to it later.',
                )
              : t('scan.pending.now', 'Checking your photo…')}
          </p>
        </div>
      );

    case 'diagnosed':
      return scan.diagnosis ? (
        <Diagnosis diagnosis={scan.diagnosis} />
      ) : (
        // The server never sends `diagnosed` without one; defensive, not a real state.
        <EscalatedCard />
      );

    case 'escalated':
      return <EscalatedCard />;

    case 'rejected':
      return (
        <div className="flex flex-col gap-1 rounded-xl bg-danger-50 p-4" role="alert">
          <p className="text-base font-semibold text-danger-700">
            {t('scan.rejected', 'This photo could not be used.')}
          </p>
          {scan.rejectReason && <p className="text-sm text-danger-700">{scan.rejectReason}</p>}
        </div>
      );
  }
}

function Diagnosis({ diagnosis }: { diagnosis: ScanDiagnosis }): ReactElement {
  const { t } = useTranslation();
  const urgency = urgencyOf(diagnosis.classKey);
  const steps = adviceSteps(diagnosis.classKey, t);

  if (diagnosis.isHealthy) {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-primary-50 p-4">
        <div className="flex items-center gap-3">
          <Leaf className="h-7 w-7 shrink-0 text-primary-700" aria-hidden />
          <div className="flex flex-col">
            <p className="text-lg font-semibold text-gray-900">
              {t('scan.healthy.title', 'Looks healthy')}
            </p>
            <p className="text-sm text-muted-700">{diseaseName(diagnosis.classKey, t)}</p>
          </div>
        </div>
        <AdviceList steps={steps} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {urgency === 'urgent' && (
        <div className="flex items-start gap-3 rounded-xl bg-danger-50 p-4" role="alert">
          <AlertTriangle className="h-6 w-6 shrink-0 text-danger-700" aria-hidden />
          <p className="text-base font-semibold text-danger-700">
            {t('scan.urgent', 'This disease spreads fast. Contact your agriculture officer today.')}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-muted-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold text-gray-900">
            {diseaseName(diagnosis.classKey, t)}
          </p>
          <span className="inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-sm font-medium text-primary-700">
            {likelihoodLabel(diagnosis.confidence, t)}
          </span>
        </div>

        <p className="text-base font-semibold text-gray-900">{t('scan.whatToDo', 'What to do')}</p>
        <AdviceList steps={steps} />

        <p className="text-sm text-muted-700">
          {t(
            'scan.disclaimer',
            'This is a best guess from a photo, not a lab test. If the damage spreads, contact your agriculture officer.',
          )}
        </p>
      </div>
    </div>
  );
}

function AdviceList({ steps }: { steps: readonly string[] }): ReactElement {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5">
      {steps.map((step) => (
        <li key={step} className="text-base text-gray-900">
          {step}
        </li>
      ))}
    </ol>
  );
}

function EscalatedCard(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted-50 p-4">
      <UserRound className="h-6 w-6 shrink-0 text-primary-700" aria-hidden />
      <p className="text-base text-gray-900">
        {t(
          'scan.escalated',
          'We could not be sure from this photo. An agriculture officer will look at it and reply.',
        )}
      </p>
    </div>
  );
}
