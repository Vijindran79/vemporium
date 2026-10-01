import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        saffron: '#E8850B',
        maroon: '#7B1E3A',
        gold: '#C9A227',
        ivory: '#FAF7F0',
      },
      fontFamily: {
        display: ['Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
