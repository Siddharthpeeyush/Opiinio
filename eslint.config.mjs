import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { ignores: ["dist/**", "node_modules/**"] },
  {
    // node:test registers subtests via describe()/it() calls whose
    // promises are owned by the test runner, not by the caller.
    // Turning these two rules off for tests/ is a runner-idiom
    // config, not a weakening of any assertion.
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
);
