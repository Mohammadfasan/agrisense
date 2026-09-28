import { useQueryClient } from '@tanstack/react-query';
import { Camera, Hand, ImageUp, Leaf, RotateCcw, ScanLine, Send, SunMedium } from 'lucide-react';
import { useEffect, useReducer, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { scanKeys, uploadScan } from '@/api/scans';
import { newUuid } from '@/lib/uuid';
import { Button, Spinner } from '@/shared/components';

import {
  PhotoError,
  preparePhoto,
  type PhotoErrorReason,
  type PreparedPhoto,
} from './preparePhoto';
import { ScanResultView } from './ScanResultView';
import { canRetrySamePhoto, classifyUploadError, type UploadFailure } from './uploadErrors';

/**
 * `/scan` — photograph a leaf, send it, see what it is.
 *
 * One screen, one step at a time, held as a single state rather than a
 * handful of booleans: "uploading" and "failed" can never both be true when
 * they are two cases of one union.
 *
 * The scan id is minted when the photo is TAKEN, not when it is sent, and a
 * failed upload returns to the preview with the same id. The server is
 * idempotent on it, so retrying on a flaky connection can never create two
 * scans. (Week 6 moves this photo into the offline outbox under that same id.)
 *
 * Online-first for now: the Dexie scan scaffold from Week 2 predates the
 * server's scan model and is redesigned in Week 6.
 */

interface Shot {
  id: string;
  capturedAt: Date;
  photo: PreparedPhoto;
}

type State =
  | { step: 'guide'; photoError: PhotoErrorReason | null }
  | { step: 'preparing' }
  | { step: 'preview'; shot: Shot; failure: UploadFailure | null }
  | { step: 'uploading'; shot: Shot }
  | { step: 'result'; shot: Shot; scanId: string };

type Action =
  | { type: 'picked' }
  | { type: 'prepared'; shot: Shot }
  | { type: 'photoFailed'; reason: PhotoErrorReason }
  | { type: 'send' }
  | { type: 'uploadFailed'; failure: UploadFailure }
  | { type: 'uploaded'; scanId: string }
  | { type: 'restart' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'picked':
      return { step: 'preparing' };
    case 'prepared':
      return { step: 'preview', shot: action.shot, failure: null };
    case 'photoFailed':
      return { step: 'guide', photoError: action.reason };
    case 'send':
      return state.step === 'preview' ? { step: 'uploading', shot: state.shot } : state;
    case 'uploadFailed':
      // Back to the preview with the SAME shot, so a retry reuses the scan id.
      return state.step === 'uploading'
        ? { step: 'preview', shot: state.shot, failure: action.failure }
        : state;
    case 'uploaded':
      return state.step === 'uploading'
        ? { step: 'result', shot: state.shot, scanId: action.scanId }
        : state;
    case 'restart':
      return { step: 'guide', photoError: null };
  }
}

/** The server refuses capture times more than a year old or in the future. */
const MAX_AGE_MS = 364 * 24 * 60 * 60 * 1000;

function captureTime(file: File): Date {
  const now = Date.now();
  const taken = file.lastModified;
  // A gallery photo keeps its own time when it is a plausible one.
  return taken > 0 && taken <= now && now - taken < MAX_AGE_MS ? new Date(taken) : new Date(now);
}

export function ScanPage(): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const plotId = searchParams.get('plotId');
  const [state, dispatch] = useReducer(reducer, { step: 'guide', photoError: null });

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // The preview is an object URL; release it when the photo changes or the
  // screen goes away. Cheap phones run out of memory after a few photos otherwise.
  const previewUrl = 'shot' in state ? state.shot.photo.previewUrl : null;
  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  async function onFile(file: File): Promise<void> {
    dispatch({ type: 'picked' });
    try {
      const photo = await preparePhoto(file);
      dispatch({
        type: 'prepared',
        shot: { id: newUuid(), capturedAt: captureTime(file), photo },
      });
    } catch (error) {
      dispatch({
        type: 'photoFailed',
        reason: error instanceof PhotoError ? error.reason : 'unreadable',
      });
    }
  }

  async function send(shot: Shot): Promise<void> {
    dispatch({ type: 'send' });
    try {
      const { scan } = await uploadScan({
        id: shot.id,
        photo: shot.photo.blob,
        capturedAt: shot.capturedAt,
        plotId,
      });
      // The result screen reads this key; seeding it means a scan decided at
      // upload is shown without another request.
      queryClient.setQueryData(scanKeys.one(scan._id), scan);
      dispatch({ type: 'uploaded', scanId: scan._id });
    } catch (error) {
      dispatch({ type: 'uploadFailed', failure: classifyUploadError(error) });
    }
  }

  function fileInput(capture: boolean, ref: React.RefObject<HTMLInputElement>): ReactElement {
    return (
      <input
        ref={ref}
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same photo again still fires a change.
          event.target.value = '';
          if (file) {
            void onFile(file);
          }
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-gray-900">{t('scan.title', 'Check a leaf')}</h2>

      {fileInput(true, cameraInput)}
      {fileInput(false, galleryInput)}

      {state.step === 'guide' && (
        <GuideStep
          photoError={state.photoError}
          onCamera={() => cameraInput.current?.click()}
          onGallery={() => galleryInput.current?.click()}
        />
      )}

      {state.step === 'preparing' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Spinner size="lg" />
          <p className="text-base text-muted-700">
            {t('scan.preparing', 'Getting the photo ready…')}
          </p>
        </div>
      )}

      {(state.step === 'preview' || state.step === 'uploading') && (
        <PreviewStep
          shot={state.shot}
          isUploading={state.step === 'uploading'}
          failure={state.step === 'preview' ? state.failure : null}
          onSend={() => {
            void send(state.shot);
          }}
          onRetake={() => {
            dispatch({ type: 'restart' });
          }}
        />
      )}

      {state.step === 'result' && (
        <ScanResultView
          scanId={state.scanId}
          photoUrl={state.shot.photo.previewUrl}
          onScanAgain={() => {
            dispatch({ type: 'restart' });
          }}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function GuideStep({
  photoError,
  onCamera,
  onGallery,
}: {
  photoError: PhotoErrorReason | null;
  onCamera: () => void;
  onGallery: () => void;
}): ReactElement {
  const { t } = useTranslation();

  const tips = [
    {
      icon: ScanLine,
      text: t('scan.tip.fill', 'Fill the photo with the damaged part of the leaf'),
    },
    { icon: Leaf, text: t('scan.tip.one', 'One leaf at a time, close and in focus') },
    { icon: SunMedium, text: t('scan.tip.light', 'Good daylight, but not harsh direct sun') },
    { icon: Hand, text: t('scan.tip.still', 'Hold the phone still') },
  ];

  return (
    <>
      <ul className="flex flex-col gap-3">
        {tips.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-base text-gray-900">{text}</span>
          </li>
        ))}
      </ul>

      {photoError !== null && (
        <p className="rounded-xl bg-danger-50 p-3 text-base text-danger-700" role="alert">
          {photoError === 'too_small'
            ? t('scan.photoError.small', 'That photo is too small. Take a closer, sharper photo.')
            : t(
                'scan.photoError.unreadable',
                'That photo could not be opened. Please take it again.',
              )}
        </p>
      )}

      <Button className="min-h-touch-lg w-full text-base" onClick={onCamera}>
        <Camera className="h-6 w-6" aria-hidden />
        {t('scan.capture', 'Take photo')}
      </Button>
      <Button variant="secondary" className="min-h-touch-md w-full text-base" onClick={onGallery}>
        <ImageUp className="h-5 w-5" aria-hidden />
        {t('scan.gallery', 'Choose from gallery')}
      </Button>
    </>
  );
}

function PreviewStep({
  shot,
  isUploading,
  failure,
  onSend,
  onRetake,
}: {
  shot: Shot;
  isUploading: boolean;
  failure: UploadFailure | null;
  onSend: () => void;
  onRetake: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const canSend = failure === null || canRetrySamePhoto(failure);

  const failureText: Record<UploadFailure, string> = {
    offline: t(
      'scan.fail.offline',
      'No connection. Your photo is kept here — send it again when you have signal.',
    ),
    server: t(
      'scan.fail.server',
      'Something went wrong on our side. Please try again in a moment.',
    ),
    invalid: t('scan.fail.invalid', 'This photo could not be read. Please take it again.'),
    tooLarge: t('scan.fail.tooLarge', 'This photo is too large. Please take it again.'),
    plotMissing: t(
      'scan.fail.plot',
      'That plot is no longer available. Go back and choose another.',
    ),
  };

  return (
    <>
      <div className="relative">
        <img
          src={shot.photo.previewUrl}
          alt={t('scan.preview.alt', 'The photo that will be checked')}
          className="aspect-square w-full rounded-xl object-cover"
        />
        {isUploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/50">
            <Spinner size="lg" />
            <p className="text-base font-medium text-white">
              {t('scan.uploading', 'Checking your photo…')}
            </p>
          </div>
        )}
      </div>

      {!isUploading && failure === null && (
        <p className="text-base text-muted-700">
          {t('scan.preview.question', 'Is the damaged part clear and inside the square?')}
        </p>
      )}

      {failure !== null && (
        <p className="rounded-xl bg-danger-50 p-3 text-base text-danger-700" role="alert">
          {failureText[failure]}
        </p>
      )}

      {canSend && (
        <Button className="min-h-touch-lg w-full text-base" disabled={isUploading} onClick={onSend}>
          <Send className="h-6 w-6" aria-hidden />
          {failure === null
            ? t('scan.send', 'Check this photo')
            : t('scan.sendAgain', 'Send again')}
        </Button>
      )}
      <Button
        variant={canSend ? 'secondary' : 'primary'}
        className="min-h-touch-md w-full text-base"
        disabled={isUploading}
        onClick={onRetake}
      >
        <RotateCcw className="h-5 w-5" aria-hidden />
        {t('scan.retake', 'Take the photo again')}
      </Button>
    </>
  );
}
