import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./", plugins: [react()],
  server: { proxy: { "/api/rail": { target: "https://www.yukino.bond", changeOrigin: true } } },
  build: { outDir: "dist-mobile", rollupOptions: { input: "mobile.html" } },
});
