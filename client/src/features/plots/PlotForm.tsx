import type { CropCode, PlotRecord } from '@agrisense/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { LocateFixed, Trash2 } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useController, useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useGeolocation } from '@/features/onboarding';
import { Button, ChoiceGroup, ConfirmDialog, Input, Textarea } from '@/shared/components';

import { deleteErrorMessage, saveErrorMessage } from './errors';
import { usePlotFields } from './fields';
import {
  plotFormSchema,
  toFormValues,
  toPlotInput,
  type PlotFormOutput,
  type PlotFormValues,
} from './plot';
import { usePlotStore } from './plotStore';

export interface PlotFormProps {
  /** The plot being edited, or `null` to create one. */
  plot: PlotRecord | null;
}

/**
 * The one form behind both `/plots/new` and `/plots/:id/edit`.
 *
 * One component rather than two because the two screens collect exactly the
 * same fields under exactly the same rules; what differs is the id the save
 * goes to, and whether there is anything to delete. Splitting them would mean
 * two copies of the GPS handling and the coordinate fallback, which is where
 * the fiddly parts are.
 *
 * Both ends save with `PUT`. That is the create — the id is minted on the
 * client (ADR 001) — and for an edit it is the endpoint offline sync will
 * replay into, so the screen exercises the same path a queued write will.
 */
export function PlotForm({ plot }: PlotFormProps): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fields, cropOptions } = usePlotFields();
  const createPlot = usePlotStore((state) => state.createPlot);
  const savePlot = usePlotStore((state) => state.savePlot);
  const deletePlot = usePlotStore((state) => state.deletePlot);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm<PlotFormValues, unknown, PlotFormOutput>({
    resolver: zodResolver(plotFormSchema),
    // `onTouched`, so a farmer is not told a field is wrong while they are
    // still on their first pass through it.
    mode: 'onTouched',
    defaultValues: plot === null ? { plantedAt: '', notes: '' } : toFormValues(plot),
  });

  const { errors, isSubmitting } = form.formState;
  const crop = useController({ control: form.control, name: 'crop' });

  const onSubmit = form.handleSubmit(async (values) => {
    setActionError(null);
    try {
      if (plot === null) {
        await createPlot(toPlotInput(values));
      } else {
        await savePlot(plot._id, toPlotInput(values, plot.boundary));
      }
      navigate('/plots', { replace: true });
    } catch (cause) {
      setActionError(saveErrorMessage(cause, t));
    }
  });

  const onDelete = async (): Promise<void> => {
    if (plot === null) {
      return;
    }
    setActionError(null);
    setIsDeleting(true);
    try {
      await deletePlot(plot._id);
      navigate('/plots', { replace: true });
    } catch (cause) {
      setActionError(deleteErrorMessage(cause, t));
      setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <Input
        label={fields.name.label}
        {...(fields.name.hint === undefined ? {} : { hint: fields.name.hint })}
        autoFocus={plot === null}
        {...form.register('name')}
        {...(errors.name ? { error: fields.name.invalid } : {})}
      />

      <ChoiceGroup<CropCode>
        legend={fields.crop.label}
        options={cropOptions}
        columns={3}
        value={crop.field.value}
        onChange={crop.field.onChange}
        {...(errors.crop ? { error: fields.crop.invalid } : {})}
      />

      <Input
        label={fields.areaAcres.label}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        max="1000"
        {...form.register('areaAcres', {
          // An empty field becomes `undefined` rather than `NaN`, which reads
          // as "missing" to the schema instead of "not a number".
          setValueAs: (value: unknown) =>
            value === '' || value === null ? undefined : Number(value),
        })}
        {...(errors.areaAcres ? { error: fields.areaAcres.invalid } : {})}
      />

      <LocationFields form={form} showCoordinates={plot !== null} />

      <Input
        label={fields.plantedAt.label}
        {...(fields.plantedAt.hint === undefined ? {} : { hint: fields.plantedAt.hint })}
        type="date"
        {...form.register('plantedAt')}
        {...(errors.plantedAt ? { error: fields.plantedAt.invalid } : {})}
      />

      <Textarea
        label={fields.notes.label}
        {...(fields.notes.hint === undefined ? {} : { hint: fields.notes.hint })}
        maxLength={500}
        {...form.register('notes')}
        {...(errors.notes ? { error: fields.notes.invalid } : {})}
      />

      {plot !== null && (
        <>
          <button
            type="button"
            className="btn-ghost w-full text-danger-700 hover:bg-danger-50"
            onClick={() => {
              setIsConfirmingDelete(true);
            }}
          >
            <Trash2 className="h-5 w-5" aria-hidden />
            {t('plot.delete', 'Delete plot')}
          </button>

          <ConfirmDialog
            open={isConfirmingDelete}
            title={t('plot.confirmDelete.title', 'Delete this plot?')}
            description={t('plot.confirmDelete.description', {
              defaultValue: '"{{name}}" and everything recorded for it will be removed.',
              name: plot.name,
            })}
            confirmLabel={t('plot.confirmDelete.confirm', 'Delete')}
            cancelLabel={t('plot.confirmDelete.cancel', 'Keep plot')}
            busy={isDeleting}
            onConfirm={() => {
              void onDelete();
            }}
            onCancel={() => {
              setIsConfirmingDelete(false);
            }}
          />
        </>
      )}

      {actionError !== null && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {actionError}
        </p>
      )}

      {/* Sticky, so saving is reachable with a thumb without scrolling past
          the last field. */}
      <div className="sticky bottom-0 flex gap-3 border-t border-muted-200 bg-white py-3">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            navigate('/plots');
          }}
        >
          {t('plot.cancel', 'Cancel')}
        </Button>
        <Button type="submit" className="flex-1" loading={isSubmitting}>
          {t('plot.save', 'Save plot')}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Where the plot is — one tap, with typed coordinates as the way out.
 *
 * The same shape as the onboarding wizard's location step, and reusing its
 * `useGeolocation`: one fix rather than a watch, nothing requested until the
 * button is tapped, and a refusal treated differently from a timeout because
 * only the first is the farmer's own decision.
 *
 * What is different here is the centroid, not the holding. A farmer standing
 * in the field they are recording is the accurate case, which is why the GPS
 * button is the prominent one and the number fields stay out of the way until
 * they are needed.
 */
function LocationFields({
  form,
  showCoordinates,
}: {
  form: UseFormReturn<PlotFormValues, unknown, PlotFormOutput>;
  /** Open the number fields from the start, for a plot that already has a place. */
  showCoordinates: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { fields } = usePlotFields();
  const { errors } = form.formState;
  const [manual, setManual] = useState(showCoordinates);

  const { status, coordinates, request } = useGeolocation((next) => {
    const options = { shouldValidate: true, shouldDirty: true } as const;
    form.setValue('latitude', next.latitude, options);
    form.setValue('longitude', next.longitude, options);
  });

  // A refusal is final until the farmer changes it in browser settings, so the
  // fields open themselves rather than waiting for another tap. So does a
  // validation error: an invalid coordinate whose field is hidden is an error
  // message nobody can see, and a farmer who never located the plot at all
  // would otherwise be refused on submit with no explanation on screen.
  const showManual =
    manual ||
    status === 'denied' ||
    errors.latitude !== undefined ||
    errors.longitude !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-gray-900">
          {t('plot.location.legend', 'Where is this plot?')}
        </p>
        <p className="text-sm text-muted-700">
          {t(
            'plot.location.hint',
            'Stand on the plot and tap the button, so warnings reach the right field.',
          )}
        </p>
      </div>

      <Button
        variant="secondary"
        className="min-h-touch-lg w-full"
        loading={status === 'locating'}
        onClick={request}
      >
        <LocateFixed className="h-5 w-5" aria-hidden />
        {t('onboarding.location.useGps', 'Use my GPS')}
      </Button>

      {/* Announced rather than only shown: the outcome of tapping that button
          is the one thing here a farmer cannot see for themselves. */}
      <p role="status" className="text-sm">
        {status === 'granted' && coordinates && (
          <span className="font-medium text-primary-700">
            {t('onboarding.location.found', {
              defaultValue: 'Location found: {{lat}}, {{lng}}',
              lat: coordinates.latitude.toFixed(5),
              lng: coordinates.longitude.toFixed(5),
            })}
          </span>
        )}
        {status === 'denied' && (
          <span className="text-muted-700">
            {t(
              'onboarding.location.denied',
              'Location permission was refused. Enter the coordinates instead.',
            )}
          </span>
        )}
        {status === 'unavailable' && (
          <span className="text-muted-700">
            {t('onboarding.location.unavailable', 'Could not get your location. Try again.')}
          </span>
        )}
      </p>

      {!showManual && (
        <button
          type="button"
          className="min-h-touch self-start text-sm font-medium text-primary-700 underline"
          onClick={() => {
            setManual(true);
          }}
        >
          {t('onboarding.location.enterManually', 'Enter coordinates by hand')}
        </button>
      )}

      {showManual && (
        <div className="flex gap-3">
          <Input
            label={fields.latitude.label}
            type="number"
            inputMode="decimal"
            step="any"
            className="flex-1"
            {...form.register('latitude', {
              setValueAs: (value: unknown) =>
                value === '' || value === null ? undefined : Number(value),
            })}
            {...(errors.latitude ? { error: fields.latitude.invalid } : {})}
          />
          <Input
            label={fields.longitude.label}
            type="number"
            inputMode="decimal"
            step="any"
            className="flex-1"
            {...form.register('longitude', {
              setValueAs: (value: unknown) =>
                value === '' || value === null ? undefined : Number(value),
            })}
            {...(errors.longitude ? { error: fields.longitude.invalid } : {})}
          />
        </div>
      )}
    </div>
  );
}
