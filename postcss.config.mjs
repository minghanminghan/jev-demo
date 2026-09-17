/**
 * Tailwind v4 through PostCSS rather than through the Vite plugin, which is
 * the only build change the move to Next actually required. Same Tailwind,
 * same app/globals.css.
 */
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
