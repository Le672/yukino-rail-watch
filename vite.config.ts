import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  server: { proxy: { '/api/rail': { target: 'https://www.yukino.bond', changeOrigin: true } } },
  plugins: [react()],
  build: { rollupOptions: { input: { web: "index.html", desktop: "desktop.html" } } },
  test: { globals: true, environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});

