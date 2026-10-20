import { accountId } from "@cleamail/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemoryStore, type Store } from "../store.js";
import { TEST_ACCOUNT } from "../test/fixtures.js";

describe("SqliteAccountRepository", () => {
  let store: Store;

  beforeEach(() => {
    store = openInMemoryStore();
  });

  afterEach(() => {
    store.close();
  });

  it("stores and reads a connected account", async () => {
    await store.accounts.upsert(TEST_ACCOUNT);

    expect(await store.accounts.get(TEST_ACCOUNT.id)).toStrictEqual({
      ok: true,
      value: TEST_ACCOUNT,
    });
  });

  it("updates the address when the same account reconnects", async () => {
    await store.accounts.upsert(TEST_ACCOUNT);
    await store.accounts.upsert({ ...TEST_ACCOUNT, address: "new@example.com" });

    const accounts = await store.accounts.list();
    expect(accounts.ok && accounts.value).toStrictEqual([
      { ...TEST_ACCOUNT, address: "new@example.com" },
    ]);
  });

  it("returns undefined for an unknown account", async () => {
    expect(await store.accounts.get(accountId("ghost"))).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});
