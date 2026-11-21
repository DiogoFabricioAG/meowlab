// El portal usa Tailwind 4 por @tailwindcss/vite y no necesita PostCSS. Este archivo evita
// que Vite suba hasta el postcss.config.mjs de la landing (raíz del repo, Tailwind 3).
export default { plugins: {} };
