import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./index.js";

/**
 * The dashboard's config: everything the packages follow, plus the hooks rules.
 *
 * The hooks rules are not style. A dependency array that lies is a stale render, and in a product
 * whose whole job is to show the user what it did to their mailbox, a stale render is a lie about
 * their inbox.
 */
export const reactConfig = [
  ...baseConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];

export default reactConfig;
