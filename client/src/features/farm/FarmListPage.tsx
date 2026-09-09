import type { ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { useTranslation } from 'react-i18next';

import { farmRepository } from '@/db';

import 'leaflet/dist/leaflet.css';

/** Centre of Sri Lanka's dry zone, until the user's own farms load. */
const DEFAULT_CENTRE: [number, number] = [7.8731, 80.7718];

export function FarmListPage(): ReactElement {
  const { t } = useTranslation();
  const farms = useLiveQuery(() => farmRepository.list(), [], []);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('farm.title', 'My farms')}</h2>

      <div className="h-64 overflow-hidden rounded-lg border border-muted-200">
        <MapContainer center={DEFAULT_CENTRE} zoom={7} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {farms.map((farm) => (
            <Marker key={farm.id} position={[farm.latitude, farm.longitude]} />
          ))}
        </MapContainer>
      </div>

      {farms.length === 0 ? (
        <p className="text-muted">{t('farm.empty', 'No farms yet. Add your first plot.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {farms.map((farm) => (
            <li key={farm.id} className="rounded-lg border border-muted-200 p-3">
              <p className="font-medium">{farm.name}</p>
              <p className="text-sm text-muted">
                {farm.district} · {farm.areaHectares} ha
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
