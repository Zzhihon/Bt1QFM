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
        'cyber-secondary': '#00FFFF', // Neon Cyan/Aqua
        'cyber-accent': '#FFFF00', // Neon Yellow
        'cyber-green': '#00FF00', // Neon Lime Green
        'cyber-red': '#FF0000', // Bright Red
        'cyber-muted': '#4A5568', // Muted gray for less important elements
        'cyber-border': '#6366F1', // Indigo for borders
        'cyber-hover-primary': '#E000E0',
        'cyber-hover-secondary': '#00E0E0',
      }
    },
  },
  plugins: [],
} 