import tailwindcssAnimate from 'tailwindcss-animate';

import { animation } from './tailwind/animation';
import { colors } from './tailwind/colors';
import { keyframes } from './tailwind/keyframes';

import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './server/src/views/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors,
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        heading: ['Cinzel', 'serif'], // New: Fantasy accent for major headings
        serif: ['"DM Serif Display"', '"Times New Roman"', 'serif'], // For narrative/immersive text
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.2' }], // 12px
        sm: ['0.875rem', { lineHeight: '1.4' }], // 14px
        base: ['1rem', { lineHeight: '1.5' }], // 16px
        lg: ['1.125rem', { lineHeight: '1.6' }], // 18px
        xl: ['1.25rem', { lineHeight: '1.6' }], // 20px
        '2xl': ['1.5rem', { lineHeight: '1.7' }], // 24px
        '3xl': ['1.875rem', { lineHeight: '1.75' }], // 30px
        '4xl': ['2.25rem', { lineHeight: '1.8' }], // 36px
        '5xl': ['3rem', { lineHeight: '1.8' }], // 48px
        '6xl': ['3.75rem', { lineHeight: '1.85' }], // 60px
      },
      lineHeight: {
        tight: '1.2',
        snug: '1.4',
        normal: '1.5',
        relaxed: '1.6',
        loose: '1.75',
      },
      letterSpacing: {
        tighter: '-0.05em',
        tight: '-0.025em',
        normal: '0em',
        wide: '0.025em',
        wider: '0.05em',
        widest: '0.1em',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes,
      animation,
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
