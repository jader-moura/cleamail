import { defineNodeConfig } from "@cleamail/config/vitest";

export default defineNodeConfig({
  test: {
    coverage: {
      // `main.ts` is the composition root: it builds the keychain stores and the Gmail client, so
      // running it in a test would mean mocking the whole machine to prove the wiring compiles.
      // Everything it wires is covered through `createApp` and `startServer`.
      exclude: ["src/**/*.test.ts", "src/**/index.ts", "src/main.ts", "src/test/**"],
    },
  },
});
