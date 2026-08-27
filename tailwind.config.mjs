/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          DEFAULT: '#0a0929',
          50: '#f4f4fa',
          100: '#e8e7f5',
          200: '#c5c3e6',
          700: '#231f6d',
          800: '#17154a',
          900: '#100e3a',
          950: '#0a0929',
        },
        surface: {
          DEFAULT: '#12103f',
          elevated: '#18154e',
          hover: '#1f1b63',
          border: 'rgba(255, 255, 255, 0.08)',
        },
        neon: {
          DEFAULT: '#c1ff72',
          hover: '#a8f748',
          glow: 'rgba(193, 255, 114, 0.35)',
          muted: 'rgba(193, 255, 114, 0.12)',
        },
      },
      fontFamily: {
        title: ['Blinker', 'sans-serif'],
        sans: ['Actor', 'sans-serif'],
      },
      boxShadow: {
        'neon': '0 0 25px -5px rgba(193, 255, 114, 0.4)',
        'neon-lg': '0 0 45px -5px rgba(193, 255, 114, 0.55)',
        'card': '0 10px 30px -10px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      }
    },
  },
  plugins: [],
};
