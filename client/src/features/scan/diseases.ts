import type { TFunction } from 'i18next';

export const CLASS_KEYS = [
  'maize_common_rust',
  'maize_healthy',
  'pepper_bacterial_spot',
  'pepper_healthy',
  'potato_early_blight',
  'potato_healthy',
  'potato_late_blight',
  'rice_brown_spot',
  'rice_healthy',
  'tomato_early_blight',
  'tomato_healthy',
  'tomato_late_blight',
] as const;
export type ClassKey = (typeof CLASS_KEYS)[number];

export type Urgency = 'none' | 'normal' | 'urgent';

const URGENCY: Record<ClassKey, Urgency> = {
  maize_common_rust: 'normal',
  maize_healthy: 'none',
  pepper_bacterial_spot: 'normal',
  pepper_healthy: 'none',
  potato_early_blight: 'normal',
  potato_healthy: 'none',
  potato_late_blight: 'urgent',
  rice_brown_spot: 'normal',
  rice_healthy: 'none',
  tomato_early_blight: 'normal',
  tomato_healthy: 'none',
  tomato_late_blight: 'urgent',
};

const NAMES: Record<ClassKey, string> = {
  maize_common_rust: 'Maize — common rust',
  maize_healthy: 'Maize — healthy',
  pepper_bacterial_spot: 'Chilli / pepper — bacterial spot',
  pepper_healthy: 'Chilli / pepper — healthy',
  potato_early_blight: 'Potato — early blight',
  potato_healthy: 'Potato — healthy',
  potato_late_blight: 'Potato — late blight',
  rice_brown_spot: 'Paddy — brown spot',
  rice_healthy: 'Paddy — healthy',
  tomato_early_blight: 'Tomato — early blight',
  tomato_healthy: 'Tomato — healthy',
  tomato_late_blight: 'Tomato — late blight',
};

const BLIGHT_EARLY = [
  'Remove the lower leaves that have spots, and take them out of the field.',
  'Water at the base of the plant and keep the leaves dry.',
  'Next season, do not plant potato or tomato in the same place.',
];

const BLIGHT_LATE = [
  'This disease spreads quickly in wet weather. Contact your agriculture officer today.',
  'Pull out badly affected plants and take them away from the field. Do not compost them.',
  'Check the plants around them every day.',
];

const HEALTHY = [
  'Keep checking your plants every week.',
  'Scan again if you see spots, yellowing or wilting.',
];

const ADVICE: Record<ClassKey, readonly string[]> = {
  maize_common_rust: [
    'Remove badly affected leaves if only a few plants have it.',
    'Ask your agriculture officer about resistant seed for next season.',
  ],
  maize_healthy: HEALTHY,
  pepper_bacterial_spot: [
    'Remove leaves and fruits with spots, and take them out of the field.',
    'Do not work among the plants while they are wet.',
    'Wash your tools after working on affected plants.',
  ],
  pepper_healthy: HEALTHY,
  potato_early_blight: BLIGHT_EARLY,
  potato_healthy: HEALTHY,
  potato_late_blight: BLIGHT_LATE,
  rice_brown_spot: [
    'Brown spot is often a sign of poor soil. Ask your agriculture officer about fertiliser.',
    'Use clean, certified seed next season.',
  ],
  rice_healthy: HEALTHY,
  tomato_early_blight: BLIGHT_EARLY,
  tomato_healthy: HEALTHY,
  tomato_late_blight: BLIGHT_LATE,
};

const UNKNOWN_ADVICE = ['Show this photo to your agriculture officer.'];

function isClassKey(key: string): key is ClassKey {
  return (CLASS_KEYS as readonly string[]).includes(key);
}

export function diseaseName(classKey: string, t: TFunction): string {
  if (!isClassKey(classKey)) {
    // A newer model's class: readable, not a raw key.
    return classKey.replace(/_/g, ' ');
  }
  return t(`scan.class.${classKey}`, NAMES[classKey]);
}

export function adviceSteps(classKey: string, t: TFunction): string[] {
  if (!isClassKey(classKey)) {
    return UNKNOWN_ADVICE.map((text, i) => t(`scan.advice.unknown.${String(i)}`, text));
  }
  return ADVICE[classKey].map((text, i) => t(`scan.advice.${classKey}.${String(i)}`, text));
}

export function urgencyOf(classKey: string): Urgency {
  return isClassKey(classKey) ? URGENCY[classKey] : 'normal';
}

/**
 * Words, not a percentage. "100% sure" on a phone reads as a guarantee, and
 * the model is wrong sometimes -- Week 4 counted the cases. Only diagnosed
 * results reach this, so the confidence is already above the threshold.
 */
export function likelihoodLabel(confidence: number, t: TFunction): string {
  return confidence >= 0.95
    ? t('scan.likelihood.high', 'Very likely')
    : t('scan.likelihood.medium', 'Likely');
}
