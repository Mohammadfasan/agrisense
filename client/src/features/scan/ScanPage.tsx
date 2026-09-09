import { useMutation } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { scanRepository } from '@/db';

export function ScanPage(): ReactElement {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // The scan is stored locally first; the outbox uploads it when there is signal.
  const capture = useMutation({
    mutationFn: (file: File) =>
      scanRepository.create({
        farmId: 'unassigned',
        cropType: 'unknown',
        image: file,
        diagnosis: null,
        confidence: null,
      }),
  });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('scan.title', 'Scan a crop')}</h2>
      <p className="text-muted">
        {t('scan.hint', 'Photograph an affected leaf. Results appear once analysed.')}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            capture.mutate(file);
          }
        }}
      />

      <button
        type="button"
        className="btn-primary"
        onClick={() => inputRef.current?.click()}
        disabled={capture.isPending}
      >
        <Camera className="h-5 w-5" aria-hidden />
        {t('scan.capture', 'Take photo')}
      </button>

      {capture.isSuccess && (
        <p className="text-sm text-primary">{t('scan.queued', 'Saved. Will sync when online.')}</p>
      )}
      {capture.isError && (
        <p className="text-sm text-danger">{t('scan.failed', 'Could not save the photo.')}</p>
      )}
    </section>
  );
}
