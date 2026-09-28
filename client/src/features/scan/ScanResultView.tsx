import { Clock, RotateCcw, ScanLine, UserRound } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ScanRecord } from '@/api/scans';
import { Button, ErrorState, Spinner } from '@/shared/components';

import { useScanResult } from './useScanResult';

/**
 * The outcome of one scan. Part B shows the four states plainly; Part C adds
 * disease names, advice and the heatmap overlay on the photo.
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

  return (
    <section className="flex flex-col gap-4">
      <img
        src={photoUrl}
        alt={t('scan.preview.alt', 'The photo that was checked')}
        className="aspect-square w-full rounded-xl object-cover"
      />
      <Outcome scan={query.data} gaveUpWaiting={gaveUpWaiting} />
      <Button
        variant={query.data.status === 'rejected' ? 'primary' : 'secondary'}
        className="min-h-touch-lg w-full text-base"
        onClick={onScanAgain}
      >
        {query.data.status === 'rejected' ? (
          <RotateCcw className="h-6 w-6" aria-hidden />
        ) : (
          <ScanLine className="h-6 w-6" aria-hidden />
        )}
        {query.data.status === 'rejected'
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
      return (
        <div className="flex flex-col gap-1 rounded-xl bg-primary-50 p-4">
          <p className="text-lg font-semibold text-gray-900">{scan.diagnosis?.classKey}</p>
          <p className="text-sm text-muted-700">
            {t('scan.confidence', {
              defaultValue: '{{percent}}% sure',
              percent: Math.round((scan.diagnosis?.confidence ?? 0) * 100),
            })}
          </p>
        </div>
      );

    case 'escalated':
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
