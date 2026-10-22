import { emailId } from "@cleamail/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openInMemoryStore, type Store } from "../store.js";

describe("SqliteAuditLog", () => {
  let store: Store;

  beforeEach(() => {
    store = openInMemoryStore();
  });

  afterEach(() => {
    store.close();
  });

  it("round-trips an entry with its details", async () => {
    const written = await store.audit.append({
      kind: "apply",
      summary: "Applied 2 action(s) to 1 email(s)",
      emailId: emailId("msg-1"),
      details: { runId: "run-1", applied: 2 },
    });

    expect(written.ok).toBe(true);

    const listed = await store.audit.list();

    expect(listed.ok && listed.value).toHaveLength(1);
    expect(listed.ok && listed.value[0]?.kind).toBe("apply");
    expect(listed.ok && listed.value[0]?.emailId).toBe("msg-1");
    expect(listed.ok && listed.value[0]?.details).toStrictEqual({ runId: "run-1", applied: 2 });
  });

  it("lists the most recent first, and respects a limit", async () => {
    for (const summary of ["first", "second", "third"]) {
      await store.audit.append({ kind: "decide", summary });
    }

    const listed = await store.audit.list({ limit: 2 });

    expect(listed.ok && listed.value.map((entry) => entry.summary)).toStrictEqual([
      "third",
      "second",
    ]);
  });

  it("keeps an entry with no email and no details", async () => {
    await store.audit.append({ kind: "refuse", summary: "Refused to apply anything" });

    const listed = await store.audit.list();

    expect(listed.ok && listed.value[0]?.emailId).toBeUndefined();
    expect(listed.ok && listed.value[0]?.details).toBeUndefined();
  });

  it("skips a row whose kind it does not know, rather than failing the list", async () => {
    await store.audit.append({ kind: "apply", summary: "real entry" });
    store.db.run(
      sql`INSERT INTO audit_log (at, kind, summary) VALUES (1792000000000, 'teleport', 'from a newer version')`,
    );

    const listed = await store.audit.list();

    expect(listed.ok && listed.value.map((entry) => entry.summary)).toStrictEqual(["real entry"]);
  });
});
