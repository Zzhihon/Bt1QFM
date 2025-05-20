/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cyber-bg': '#0A0F37', // Deep indigo/navy
        'cyber-bg-darker': '#05081E', // Even darker for contrasts
        'cyber-text': '#F0F0F0', // Off-white/light gray for general text
        'cyber-primary': '#FF00FF', // Neon Pink/Magenta
        'cyber-secondary': '#372963', // Neon Cyan/Aqua
        'cyber-green': '#00FF00', // Neon Lime Green
        'cyber-red': '#FF0000', // Bright Red
        'cyber-muted': '#4A5568', // Muted gray for less important elements
        'cyber-hover-primary': '#E000E0',
        'cyber-hover-secondary': '#00E0E0',
      }
    },
  },
  plugins: [],
} 