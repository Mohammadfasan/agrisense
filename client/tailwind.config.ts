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
      },
      minWidth: { touch: '44px' },
      minHeight: { touch: '44px' },
    },
  },
  plugins: [],
};

export default config;
