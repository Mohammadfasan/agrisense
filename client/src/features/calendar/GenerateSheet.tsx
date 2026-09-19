import { isoDateSchema, type CalendarTaskRecord, type IsoDate } from '@agrisense/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { calendarKeys, generateCalendar } from '@/api/calendar';
import { usePlotStore } from '@/features/plots/plotStore';
import { newUuid } from '@/lib/uuid';
import { BottomSheet, Button, Input } from '@/shared/components';
import { todayIso } from '@/shared/i18n/dates';

import { generateErrorMessage } from './errors';

export interface GenerateSheetProps {
  /** The plot whose season is being built. */
  plotId: string;
  /** Pre-fills the field on a regeneration. Absent or `null` when none is recorded. */
  sowingDate?: IsoDate | null | undefined;
  /** Whether this run will rebuild an existing calendar, which changes the wording. */
  isRebuild: boolean;
  onClose: () => void;
  /** Handed the tasks the server wrote, for whatever the screen says next. */
  onGenerated?: (tasks: readonly CalendarTaskRecord[]) => void;
}

/**
 * Asks for the sowing date, then builds the plot's season from it.
 *
 * **Mounted only while it is open, and that is load-bearing.** The batch id is
 * minted once per mount, which is once per opening of the sheet, and every
 * attempt inside that opening — the first one, and the retry after a timeout —
 * sends the same id. The server is idempotent on that id rather than on the
 * request, so a phone that sent the request, lost signal before the answer and
 * tried again lands on the tasks it already wrote instead of laying a second
 * calendar over the first. Minting per attempt would be the bug this endpoint
 * was shaped to prevent; minting per *mount* is also why closing and reopening
 * the sheet is a deliberate rebuild.
 *
 * One field, and a native date input for it: the platform picker is already in
 * the farmer's language and already knows their calendar, and its value is
 * `YYYY-MM-DD` — exactly what the API takes, with no conversion and so no day
 * to lose to UTC+05:30.
 */
export function GenerateSheet({
  plotId,
  sowingDate,
  isRebuild,
  onClose,
  onGenerated,
}: GenerateSheetProps): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchPlot = usePlotStore((state) => state.fetchPlot);

  // One id for this opening of the sheet. See the note above the component.
  const [generationBatchId] = useState(newUuid);
  const [day, setDay] = useState<string>(sowingDate ?? todayIso());
  const [isInvalid, setIsInvalid] = useState(false);

  const generate = useMutation({
    mutationFn: (input: { sowingDate: IsoDate }) =>
      generateCalendar(plotId, { sowingDate: input.sowingDate, generationBatchId }),
    onSuccess: (result) => {
      // The tasks the server just returned are the plot's calendar, so they go
      // straight into the cache rather than being fetched back immediately.
      queryClient.setQueryData(calendarKeys.plot(plotId), result.tasks);
      // Everything else calendar-shaped is now stale -- the home screen's
      // buckets most of all, which span every plot.
      void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
      // Generation writes `sowingDate` onto the plot, and the header above
      // this sheet reads it from the plot store.
      void fetchPlot(plotId);
      onGenerated?.(result.tasks);
      onClose();
    },
  });

  const onSubmit = (): void => {
    const parsed = isoDateSchema.safeParse(day);
    if (!parsed.success) {
      setIsInvalid(true);
      return;
    }
    setIsInvalid(false);
    generate.mutate({ sowingDate: parsed.data });
  };

  return (
    <BottomSheet
      open
      busy={generate.isPending}
      title={
        isRebuild
          ? t('calendar.generate.rebuildTitle', 'Build the calendar again')
          : t('calendar.generate.title', 'Build the calendar')
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <p className="text-sm text-muted-700">
          {t(
            'calendar.generate.description',
            'The work for the whole season is worked out from the day the crop goes in.',
          )}
        </p>

        <Input
          label={t('calendar.generate.field', 'Which day was it sown?')}
          type="date"
          value={day}
          onChange={(event) => {
            setDay(event.target.value);
          }}
          {...(isInvalid
            ? { error: t('calendar.generate.invalid', 'Choose the day the crop was sown.') }
            : {})}
        />

        {generate.isError && (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {generateErrorMessage(generate.error, t)}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={generate.isPending}
            onClick={onClose}
          >
            {t('calendar.cancel', 'Cancel')}
          </Button>
          {/* The retry after a failure is this same button, and it carries the
              same batch id -- which is what makes pressing it safe. */}
          <Button type="submit" className="min-h-touch-md flex-1" loading={generate.isPending}>
            {generate.isError
              ? t('common.retry', 'Try again')
              : t('calendar.generate.action', 'Build calendar')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
