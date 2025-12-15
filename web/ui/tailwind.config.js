/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cyber-bg': 'var(--cyber-bg)',
        'cyber-bg-darker': 'var(--cyber-bg-darker)',
        'cyber-text': 'var(--cyber-text)',
        'cyber-primary': 'var(--cyber-primary)',
        'cyber-secondary': 'var(--cyber-secondary)',
        'cyber-hover-primary': 'var(--cyber-hover-primary)',
        'cyber-hover-secondary': 'var(--cyber-hover-secondary)',
        'cyber-accent': 'var(--cyber-primary)',
        'cyber-red': 'var(--cyber-red)',
      }
    },
  },
  plugins: [],
} 