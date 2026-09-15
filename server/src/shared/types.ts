/**
 * Cross-cutting domain primitives.
 *
 * These now live in `@agrisense/shared`, so the PWA validates against the same
 * locale list, the same coordinate bounds and the same district and crop
 * enums the API enforces. This module stays as the API's way in to them:
 * every existing `@shared/types` and `@shared` import keeps working, and
 * server-only additions still have somewhere to go.
 */
export {
  CROP_CODES,
  DEFAULT_LOCALE,
  DISTRICTS,
  LOCALES,
  cropCodeSchema,
  districtSchema,
  farmerProfileSchema,
  farmerProfileUpdateSchema,
  geoPointSchema,
  geoPositionSchema,
  isCropCode,
  isDistrict,
  isLocaleCode,
  localeCodeSchema,
  localeSchema,
  point,
  type CropCode,
  type District,
  type FarmerProfileInput,
  type FarmerProfileUpdateInput,
  type GeoPoint,
  type GeoPosition,
  type Locale,
  type LocaleCode,
} from '@agrisense/shared';
