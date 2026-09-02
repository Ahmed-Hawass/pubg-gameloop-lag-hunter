import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // cargo's target dir is huge — watching it crashes vite's watcher
      ignored: ["**/src-tauri/**", "**/node_modules/**", "**/reference-js/**", "**/sessions/**"],
    },
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2021",
    minify: true,
    sourcemap: false,
  },
});
