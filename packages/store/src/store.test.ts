import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
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

  it("opens in a mode two processes can share", () => {
    const store = openStore({ path });

    try {
      // WAL so the CLI and the server do not block each other's reads, and a wait rather than an
      // instant SQLITE_BUSY when their writes do collide.
      expect(store.db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)).toStrictEqual({
        journal_mode: "wal",
      });
      expect(store.db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)).toStrictEqual({
        timeout: 5000,
      });
      expect(store.db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)).toStrictEqual({
        foreign_keys: 1,
      });
    } finally {
      store.close();
    }
  });

  it("lets a second connection write while the first is open", async () => {
    const first = openStore({ path });
    const second = openStore({ path });

    try {
      await first.accounts.upsert(TEST_ACCOUNT);

      // What the server and the CLI will be doing all day once SPEC-013 lands.
      expect((await second.emails.saveEmails([anEmail()])).ok).toBe(true);
      expect(await first.emails.countEmails(TEST_ACCOUNT.id)).toStrictEqual({ ok: true, value: 1 });
    } finally {
      second.close();
      first.close();
    }
  });
});
