import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app imports the library straight from ../src. Resolve that code's
// dependencies from web/node_modules, so deploying web/ alone works.
const fromWeb = (pkg: string) => fileURLToPath(new URL(`./node_modules/${pkg}`, import.meta.url));

export default defineConfig({
  // Set by the GitHub Pages workflow to /<repo>/; "/" for Netlify or local dev.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  define: { global: "globalThis" },
  resolve: {
    alias: {
      "@stellar/stellar-sdk": fromWeb("@stellar/stellar-sdk"),
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
