import { CROP_CODES, type CropCode } from '@agrisense/shared';
import { Cherry, Flame, Grape, Sprout, Wheat, type LucideIcon } from 'lucide-react';

/**
 * An icon and an English fallback per crop, for the picker in step 2.
 *
 * The icons are the nearest thing lucide has, not the crops themselves:
 * there is no onion or brinjal in the set, so those borrow a bulb-and-shoot
 * and a purple cluster. They are recognisable rather than correct, and for an
 * audience that may be reading the label with difficulty that is a real
 * limitation -- `crops.imageUrl` (`docs/schema.md` §5) is where the actual
 * artwork belongs once the master data is seeded, and this should be replaced
 * by it rather than extended.
 *
 * Keyed by `CropCode`, so adding a crop to the shared list fails the build
 * here until it has an icon.
 */
export const CROP_META: Record<CropCode, { icon: LucideIcon; fallback: string }> = {
  PADDY: { icon: Wheat, fallback: 'Paddy' },
  TOMATO: { icon: Cherry, fallback: 'Tomato' },
  CHILLI: { icon: Flame, fallback: 'Chilli' },
  ONION: { icon: Sprout, fallback: 'Onion' },
  BRINJAL: { icon: Grape, fallback: 'Brinjal' },
};

/** The crops in the order they are offered, with their presentation. */
export const CROP_OPTIONS = CROP_CODES.map((code) => ({ code, ...CROP_META[code] }));
