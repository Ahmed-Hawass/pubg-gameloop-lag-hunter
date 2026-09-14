// eslint config — lint matches what CI runs: hooks correctness (the root
// cause class behind the summary-timer bug) plus baseline TS hygiene.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", "scripts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
