import baseConfig from "@cleamail/config/eslint";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      // `core` is the domain: it depends on nothing in this repo and does no I/O.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@cleamail/*", "node:*", "fs", "path", "http", "https", "crypto"],
              message:
                "core must stay dependency-free and I/O-free. Put adapters in providers, llm or store.",
            },
          ],
        },
      ],
    },
  },
];
