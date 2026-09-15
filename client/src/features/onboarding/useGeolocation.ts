import { useCallback, useState } from 'react';

/**
 * What happened the last time a position was asked for.
 *
 * `denied` is kept apart from `unavailable` because only the first is the
 * farmer's own decision: a denial means offer the manual fields and stop
 * asking, while an unavailable or timed-out fix is worth another try.
 */
export type GeolocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable';

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Metres, as the device reports it. Absent on some browsers. */
  accuracy?: number;
}

export interface GeolocationState {
  status: GeolocationStatus;
  coordinates: Coordinates | null;
  request: () => void;
}

/**
 * One-shot access to `navigator.geolocation`.
 *
 * A single fix rather than `watchPosition`: the wizard wants the farmer's
 * holding, which does not move, and a watch would keep the GPS radio awake on
 * a phone whose battery is the reason this app is offline-first.
 *
 * Nothing is requested until {@link GeolocationState.request} is called, so
 * the browser's permission prompt appears in response to a tap rather than on
 * arriving at the step -- a prompt a farmer did not ask for is the one they
 * dismiss.
 */
export function useGeolocation(onSuccess?: (coordinates: Coordinates) => void): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const request = useCallback(() => {
    // Absent over plain HTTP on a phone, and in a few embedded webviews.
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const next: Coordinates = {
          latitude,
          longitude,
          ...(Number.isFinite(accuracy) ? { accuracy } : {}),
        };
        setCoordinates(next);
        setStatus('granted');
        onSuccess?.(next);
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      {
        enableHighAccuracy: true,
        // Long, because a cold GPS fix under tree cover genuinely takes this
        // long, and a farmer who tapped the button would rather wait than be
        // told it failed and have to tap again.
        timeout: 20_000,
        // A fix from the last two minutes is the same field.
        maximumAge: 120_000,
      },
    );
  }, [onSuccess]);

  return { status, coordinates, request };
}
