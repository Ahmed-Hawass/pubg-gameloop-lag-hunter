import { defineConfig } from "vitest/config";
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
      ignored: ["**/src-tauri/**", "**/node_modules/**"],
    },
  },
  build: {
    target: "es2021",
    minify: true,
    sourcemap: false,
  },
  test: {
    // component tests render React (Dialog, UpdateModal, ToolsView, App),
    // so the whole suite runs in a DOM instead of bare Node
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/tests/**",
        "src/vite-env.d.ts",
        "src/assets/**",
        "**/*.d.ts",
      ],
      // coverage floor: a change that drops below these fails the suite,
      // so the safety net can only grow, never shrink silently
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 45,
        lines: 65,
      },
    },
  },
});
