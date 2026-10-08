// The admin console's styles are compiled by @tailwindcss/vite (Tailwind v4,
// see vite.config.ts) — no PostCSS plugins are needed here.
//
// This empty config also stops Vite from walking up the directory tree and
// picking the parent folder's Tailwind v3 postcss.config.js (the old root
// app), whose `tailwindcss` dependency is not installed and breaks every CSS
// transform in this app with "Cannot find module 'tailwindcss'".
export default { plugins: [] };
