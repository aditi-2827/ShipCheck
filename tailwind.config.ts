import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: '#08090B',
        panel: '#111418',
        panelAlt: '#0D0F12',
        border: '#20252B',
        text: '#E7EAF0',
        muted: '#7D8590',
        success: '#32E875',
        warning: '#FFC857',
        danger: '#FF5C5C',
        accent: '#36D9FF',
        cyan: '#36D9FF',
        violet: '#A78BFA',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(110, 231, 183, 0.18), 0 0 28px rgba(60, 203, 122, 0.12)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
};

export default config;
