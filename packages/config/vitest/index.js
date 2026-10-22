import { defineConfig, mergeConfig } from "vitest/config";

/** Defaults every node package shares: tests live next to the code they cover. */
const nodeDefaults = defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/index.ts"],
    },
  },
});

/** Defaults for the dashboard: a DOM, and tests that may be .tsx. */
const reactDefaults = defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/index.ts", "src/main.tsx", "src/test/**"],
    },
  },
});

/**
 * @param {import("vitest/config").UserConfig} [overrides]
 * @returns {import("vitest/config").UserConfig}
 */
export function defineNodeConfig(overrides = {}) {
  return mergeConfig(nodeDefaults, overrides);
}

/**
 * @param {import("vitest/config").UserConfig} [overrides]
 * @returns {import("vitest/config").UserConfig}
 */
export function defineReactConfig(overrides = {}) {
  return mergeConfig(reactDefaults, overrides);
}

export default nodeDefaults;
