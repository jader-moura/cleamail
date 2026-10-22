import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Testing Library only registers its own cleanup when vitest runs with globals, which this
 * workspace does not. Without this, every render stays in the document and the next test finds two
 * of everything.
 */
afterEach(() => {
  cleanup();
});
