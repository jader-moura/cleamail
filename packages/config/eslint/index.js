import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared flat config for every TypeScript package in the workspace.
 *
 * Type-aware linting is on, which is what lets us enforce the repo conventions
 * mechanically: no `any`, no floating promises, type-only imports marked as such.
 */
export const baseConfig = tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".turbo/**", "node_modules/**", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      // Conventions from CLAUDE.md: no `any`, narrow `unknown` instead.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // Convention: `type` for data shapes (Zod-inferred types are aliases anyway), `interface`
      // for ports. Neither is an error, so the stylistic rule is off.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Logs must never carry email content; packages log through an injected logger.
      "no-console": "error",
      eqeqeq: ["error", "smart"],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a union type or a const object instead of an enum.",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**/*.ts", "**/fixtures/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
  {
    files: ["*.config.ts", "*.config.js", "*.config.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Plain JS (configs, this file) is not part of any tsconfig, so type-aware rules cannot run.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);

export default baseConfig;
