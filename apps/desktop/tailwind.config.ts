import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Brand Primary — Electric Teal
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#8cfce5",
          300: "#4df9d9",
          400: "#1debc7",
          500: "#00e6bc",
          600: "#00cca7",
          700: "#00b392",
          800: "#008c72",
          900: "#006653",
          950: "#004034",
        },
        // Also remap standard teal to match brand exactly
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#8cfce5",
          300: "#4df9d9",
          400: "#1debc7",
          500: "#00e6bc",
          600: "#00cca7",
          700: "#00b392",
          800: "#008c72",
          900: "#006653",
          950: "#004034",
        },
        emergency: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        institutionA: {
          primary: '#1e40af',
          light: '#dbeafe',
        },
        institutionB: {
          primary: '#b91c1c',
          light: '#fee2e2',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
