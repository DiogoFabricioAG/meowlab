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
        sans: ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        title: ['Blinker', 'sans-serif'],
        display: ['Blinker', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        'xl': '14px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        'soft': '0 10px 40px rgba(20, 40, 30, 0.05)',
        'card': '0 4px 20px rgba(12, 73, 60, 0.04)',
        'hover': '0 14px 35px -8px rgba(12, 73, 60, 0.08)',
        'elevated': '0 20px 50px -12px rgba(12, 73, 60, 0.12)',
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
