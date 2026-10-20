import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore } from "./store.js";
import { anEmail, TEST_ACCOUNT } from "./test/fixtures.js";

describe("openStore", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "cleamail-store-"));
    path = join(directory, "nested", "cleamail.sqlite");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates the directory and the schema on first open, and is a no-op on reopen", async () => {
    const first = openStore({ path });
    await first.accounts.upsert(TEST_ACCOUNT);
    await first.emails.saveEmails([anEmail()]);
    first.close();

    // Reopening runs the migration journal again; it must find nothing to do and keep the data.
    const second = openStore({ path });
    try {
      expect(await second.emails.countEmails(TEST_ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: 1,
      });
    } finally {
      second.close();
    }
  });

  it("reports the path it opened", () => {
    const store = openStore({ path });
    try {
      expect(store.path).toBe(path);
    } finally {
      store.close();
    }
  });
});
