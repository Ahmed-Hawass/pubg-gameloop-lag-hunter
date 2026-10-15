import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The boot splash theme (src/splash-theme.js) is a classic script, not a
// module, so it runs during HTML parse before first paint. Vite only
// bundles module scripts from index.html, so the build emits this file
// verbatim at the same path the tag points to (dev serves /src/*
// natively, no plugin needed there).
function splashThemeScript(): Plugin {
  return {
    name: "splash-theme-external",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "src/splash-theme.js",
        source: readFileSync("src/splash-theme.js", "utf8"),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), splashThemeScript()],
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
        // locale dictionaries are data (every key is imported by each test):
        // counting them inflates statements without measuring logic
        "src/locales/**",
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
