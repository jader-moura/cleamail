import baseConfig from "@cleamail/config/eslint";

export default [
  ...baseConfig,
  {
    files: ["src/repositories/**/*.ts"],
    rules: {
      // The store ports are async so a future remote store fits, but better-sqlite3 is synchronous:
      // these methods return a settled promise and have nothing to await.
      "@typescript-eslint/require-await": "off",
    },
  },
];
