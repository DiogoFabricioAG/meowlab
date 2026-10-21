/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          forest: '#0C493C',
          'forest-hover': '#08372D',
          'forest-dark': '#062821',
          mint: '#D8F0E5',
          'mint-light': '#F0F9F5',
          'mint-subtle': '#E7F5EE',
          'mint-dark': '#8BC9AD',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F7F9F7',
          muted: '#EEF2EF',
          border: '#E8ECE9',
          'border-subtle': '#F0F3F1',
          'border-mint': '#C3E5D4',
        },
        content: {
          main: '#111816',
          secondary: '#586561',
          muted: '#8A9691',
          faint: '#BDC7C2',
        },
      },
      fontFamily: {
        sans: ['Actor', 'sans-serif'],
        title: ['Blinker', 'sans-serif'],
        display: ['Blinker', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        'xl': '10px',
        '2xl': '14px',
        '3xl': '18px',
      },
      boxShadow: {
        'soft': '0 1px 3px rgba(17, 24, 22, 0.04), 0 1px 2px rgba(17, 24, 22, 0.02)',
        'card': '0 2px 6px rgba(17, 24, 22, 0.05), 0 1px 2px rgba(17, 24, 22, 0.03)',
        'card-hover': '0 8px 20px rgba(12, 73, 60, 0.08), 0 2px 4px rgba(12, 73, 60, 0.04)',
        'hover': '0 8px 20px rgba(12, 73, 60, 0.08), 0 2px 4px rgba(12, 73, 60, 0.04)',
        'elevated': '0 12px 28px -6px rgba(12, 73, 60, 0.10)',
      },
      animation: {
        'pulse-subtle': 'pulseSubtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};
