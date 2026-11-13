import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    // `npm run dev:web` serves the UI with hot reload and sends the API to wrangler dev.
    proxy: { "/api": "http://localhost:8787" },
  },
});
