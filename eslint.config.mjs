import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "next-env.d.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    // The plugin still ships its configs in the old shape, so the rules are
    // lifted out and the plugin is registered by hand.
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
  {
    // The things here that run in Node rather than in the tab: the build
    // config, the snapshot script, and the two API routes. Everything else is
    // browser-only and stays that way. See AGENTS.md.
    files: ["next.config.ts", "scripts/**/*.mjs", "app/api/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
