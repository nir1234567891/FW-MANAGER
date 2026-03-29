/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // primary shades all point to CSS variables – updated live by useSettings
        primary: {
          50:  'color-mix(in srgb, var(--accent) 8%,  white)',
          100: 'color-mix(in srgb, var(--accent) 15%, white)',
          200: 'color-mix(in srgb, var(--accent) 30%, white)',
          300: 'color-mix(in srgb, var(--accent) 55%, white)',
          400: 'var(--accent-light)',
          500: 'var(--accent)',
          600: 'var(--accent-dark)',
          700: 'var(--accent-darker)',
          800: 'color-mix(in srgb, var(--accent) 60%, black)',
          900: 'color-mix(in srgb, var(--accent) 40%, black)',
          950: 'color-mix(in srgb, var(--accent) 25%, black)',
        },
        dark: {
          950: '#020617',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
      },
      keyframes: {
        fadeIn:       { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp:      { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { '0%': { opacity: '0', transform: 'translateX(100%)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
};
