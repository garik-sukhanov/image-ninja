/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#16171c',
        'panel-2': '#1e1f26',
        'panel-3': '#262832',
        'panel-4': '#31333f',
        accent: '#00d6a4',
        'accent-2': '#ff7a45',
        border: '#2c2e38',
      },
    },
  },
  plugins: [],
};
