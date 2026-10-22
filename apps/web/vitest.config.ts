import react from "@vitejs/plugin-react";
import { defineReactConfig } from "@cleamail/config/vitest";

export default defineReactConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
