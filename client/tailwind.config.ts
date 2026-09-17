import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * The four brand hexes are exactly Tailwind's green-600, red-600, amber-500 and
 * gray-500, so each token aliases its source scale rather than inventing tints.
 * `bg-primary` is the specified #16a34a; `bg-primary-700` gives a real hover
 * shade from the same ramp instead of a hand-mixed guess.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { ...colors.green, DEFAULT: colors.green[600] }, // #16a34a
        danger: { ...colors.red, DEFAULT: colors.red[600] }, // #dc2626
        warning: { ...colors.amber, DEFAULT: colors.amber[500] }, // #f59e0b
        muted: { ...colors.gray, DEFAULT: colors.gray[500] }, // #6b7280
      },
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans Tamil',
          'Noto Sans Sinhala',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      spacing: {
        // WCAG 2.5.5 minimum touch target.
        touch: '44px',
        // The floor for anything a farmer taps standing in a field: 44px is
        // what the guideline allows, and this audience is using the phone
        // one-handed, in sunlight, often with wet or gloved hands. Everything
        // on the home screen and in the navigation is sized from this.
        'touch-md': '48px',
        // For the few one-tap choices that carry a whole screen -- picking a
        // language, say. Sized for a thumb on a phone held in the field.
        'touch-lg': '64px',
      },
      minWidth: { touch: '44px', 'touch-md': '48px' },
      minHeight: { touch: '44px', 'touch-md': '48px', 'touch-lg': '64px' },
    },
  },
  plugins: [],
};

export default config;
