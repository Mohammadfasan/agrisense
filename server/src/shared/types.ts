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
  PLOT_PAGE_SIZE_DEFAULT,
  PLOT_PAGE_SIZE_MAX,
  cropCodeSchema,
  districtSchema,
  farmerProfileSchema,
  farmerProfileUpdateSchema,
  geoLinearRingSchema,
  geoPointSchema,
  geoPolygonSchema,
  geoPositionSchema,
  isCropCode,
  isDistrict,
  isLocaleCode,
  localeCodeSchema,
  localeSchema,
  plotCreateSchema,
  plotIdSchema,
  plotListQuerySchema,
  plotSchema,
  plotUpdateSchema,
  point,
  polygonCentroid,
  type CropCode,
  type District,
  type FarmerProfileInput,
  type FarmerProfileUpdateInput,
  type GeoLinearRing,
  type GeoPoint,
  type GeoPolygon,
  type GeoPosition,
  type Locale,
  type LocaleCode,
  type PlotId,
  type PlotInput,
  type PlotListQuery,
  type PlotRecord,
  type PlotUpdateInput,
} from '@agrisense/shared';
