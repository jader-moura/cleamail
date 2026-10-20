import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openInMemoryStore, type Store } from "../store.js";

const TrashRuleSchema = z.object({
  enabled: z.boolean(),
  afterDays: z.number().int().min(1).max(365),
});

describe("SqliteSettingsRepository", () => {
  let store: Store;

  beforeEach(() => {
    store = openInMemoryStore();
  });

  afterEach(() => {
    store.close();
  });

  it("returns undefined for a key that was never written", async () => {
    expect(await store.settings.get("trashRule", TrashRuleSchema)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("round-trips a validated value", async () => {
    await store.settings.set("trashRule", { enabled: true, afterDays: 30 });

    expect(await store.settings.get("trashRule", TrashRuleSchema)).toStrictEqual({
      ok: true,
      value: { enabled: true, afterDays: 30 },
    });
  });

  it("overwrites on a second write", async () => {
    await store.settings.set("trashRule", { enabled: true, afterDays: 30 });
    await store.settings.set("trashRule", { enabled: false, afterDays: 7 });

    const read = await store.settings.get("trashRule", TrashRuleSchema);
    expect(read.ok && read.value).toStrictEqual({ enabled: false, afterDays: 7 });
  });

  it("refuses a stored value that no longer validates", async () => {
    await store.settings.set("trashRule", { enabled: true, afterDays: 9000 });

    const read = await store.settings.get("trashRule", TrashRuleSchema);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe("config_invalid");
  });

  it("deletes a key", async () => {
    await store.settings.set("trashRule", { enabled: true, afterDays: 30 });
    await store.settings.delete("trashRule");

    expect(await store.settings.get("trashRule", TrashRuleSchema)).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});
