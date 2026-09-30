import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { rollupOptions: { input: { web: "index.html", desktop: "desktop.html" } } },
  test: { globals: true, environment: "jsdom", setupFiles: ["./src/test/setup.ts"] },
});

