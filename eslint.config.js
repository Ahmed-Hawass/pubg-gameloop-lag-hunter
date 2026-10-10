// eslint config — lint matches what CI runs: hooks correctness (the root
// cause class behind the summary-timer bug) plus baseline TS hygiene.
//
// NOTE on eslint-plugin-react-refresh/only-export-components: deliberately
// not enabled. The design-system modules (components.tsx and friends)
// intentionally mix components with helpers, constants, and dispatchers
// (diagnosisIcon, fmtDur, MODAL_OPEN_EVENT, dispatchModalOpen...), so the
// rule would flood every export with warnings under --max-warnings=0.
// Fast refresh still works via @vitejs/plugin-react; no lint gate needed.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", "src-tauri/target"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // boot splash theme: plain browser script (no imports, no bundle),
    // needs document/window as readonly globals for the no-undef rule
    files: ["src/splash-theme.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // exhaustive-deps is the rule that catches the stale-closure class
      // (the summary-timer bug); the newer compiler-style rules
      // (set-state-in-effect etc.) flag deliberate patterns this codebase
      // relies on (event-push effects) and stay off for now
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refetching-after": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
