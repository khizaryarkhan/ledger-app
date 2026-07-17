/** @type {import('tailwindcss').Config} */

// Theme-aware palette: these steps resolve through CSS variables defined in
// app/globals.css. :root carries Tailwind's own literal values (so the dark
// app and the light-first landing pages render pixel-identical by default);
// a [data-theme="light"] ancestor — set only on the app shell — swaps them.
// Accent steps 600+ are NOT routed through variables: they're dark enough to
// hold contrast on both surfaces, and leaving them literal keeps solid
// buttons (bg-emerald-600 etc.) stable across themes.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const accentSteps = (family) => ({
  200: v(`${family}-200`),
  300: v(`${family}-300`),
  400: v(`${family}-400`),
  500: v(`${family}-500`),
});

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          navy:  '#092759',
          orange:'#E46310',
          'orange-dark': '#c85508',
        },
        white: v('c-white'),
        stone: {
          50: v('st-50'), 100: v('st-100'), 200: v('st-200'), 300: v('st-300'),
          400: v('st-400'), 500: v('st-500'), 600: v('st-600'), 700: v('st-700'),
          800: v('st-800'), 900: v('st-900'), 950: v('st-950'),
        },
        emerald: accentSteps('emerald'),
        rose:    accentSteps('rose'),
        amber:   accentSteps('amber'),
        sky:     accentSteps('sky'),
        blue:    accentSteps('blue'),
        violet:  accentSteps('violet'),
        orange:  accentSteps('orange'),
        teal:    accentSteps('teal'),
        cyan:    accentSteps('cyan'),
        indigo:  accentSteps('indigo'),
        fuchsia: accentSteps('fuchsia'),
      },
    },
  },
  plugins: [],
};
