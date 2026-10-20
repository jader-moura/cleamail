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

/**
 * @param {import("vitest/config").UserConfig} [overrides]
 * @returns {import("vitest/config").UserConfig}
 */
export function defineNodeConfig(overrides = {}) {
  return mergeConfig(nodeDefaults, overrides);
}

export default nodeDefaults;
