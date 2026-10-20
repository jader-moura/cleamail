import { emailId } from "@cleamail/core";
import { GOOGLE_CLIENT_KEY, loadClientCredentials } from "@cleamail/providers";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli.js";
import { EXIT } from "../exit.js";
import { ACCOUNT, anEmail, createHarness, NOW } from "../test/harness.js";

describe("run", () => {
  it("fetches the window into the database and reports counts", async () => {
    const harness = await createHarness({
      emails: [anEmail(), anEmail({ id: emailId("msg-2") })],
    });

    try {
      expect(await runCli(["run", "--since", "7d"], harness.deps)).toBe(EXIT.ok);

      expect(harness.output()).toContain("fetched   2");
      expect(harness.output()).toContain("new       2");
      expect(harness.output()).toContain("Nothing in your mailbox was changed.");

      expect(await harness.store.emails.countEmails(ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: 2,
      });
    } finally {
      harness.close();
    }
  });

  it("stores no duplicates when it runs twice", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      await runCli(["run"], harness.deps);
      await runCli(["run"], harness.deps);

      expect(harness.output()).toContain("updated   1");
      expect(await harness.store.emails.countEmails(ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("records the sync time", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      await runCli(["run"], harness.deps);

      expect(await harness.store.emails.lastSyncAt(ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: NOW,
      });
    } finally {
      harness.close();
    }
  });

  it("leaves out messages older than the window", async () => {
    const harness = await createHarness({
      emails: [
        anEmail({ id: emailId("recent"), receivedAt: new Date("2026-10-19T10:00:00.000Z") }),
        anEmail({ id: emailId("ancient"), receivedAt: new Date("2026-01-01T10:00:00.000Z") }),
      ],
    });

    try {
      await runCli(["run", "--since", "7d"], harness.deps);

      const stored = await harness.store.emails.listEmails({ accountId: ACCOUNT.id });
      expect(stored.ok && stored.value.map((email) => email.id)).toStrictEqual(["recent"]);
    } finally {
      harness.close();
    }
  });

  it("refuses an unreadable --since without touching the mailbox", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      expect(await runCli(["run", "--since", "soon"], harness.deps)).toBe(EXIT.usage);
      expect(harness.errors()).toContain("Could not read");
      expect(await harness.store.emails.countEmails(ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: 0,
      });
    } finally {
      harness.close();
    }
  });

  it("tells an unconnected user what to do", async () => {
    const harness = await createHarness({ connected: false });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.failure);
      expect(harness.errors()).toContain("cleamail init");
    } finally {
      harness.close();
    }
  });
});

describe("status", () => {
  it("shows the account, the counts and the model server", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      await runCli(["run"], harness.deps);
      harness.stdout.length = 0;

      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("user@example.com (gmail)");
      expect(output).toContain("messages   1");
      expect(output).toContain(NOW.toISOString());
      expect(output).toContain("ollama     running (2 models)");
    } finally {
      harness.close();
    }
  });

  it("reports an unconnected mailbox without failing", async () => {
    const harness = await createHarness({ connected: false });

    try {
      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("mailbox    not connected");
    } finally {
      harness.close();
    }
  });

  it("reports an unreachable Ollama", async () => {
    const harness = await createHarness({ ollama: false });

    try {
      await runCli(["status"], harness.deps);

      expect(harness.output()).toContain("ollama     not reachable");
    } finally {
      harness.close();
    }
  });
});

describe("logout", () => {
  it("removes both credentials and keeps the database", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      await runCli(["run"], harness.deps);
      expect(await runCli(["logout"], harness.deps)).toBe(EXIT.ok);

      expect(await harness.tokens.get(ACCOUNT.id)).toStrictEqual({ ok: true, value: undefined });
      expect(await harness.secrets.get(GOOGLE_CLIENT_KEY)).toStrictEqual({
        ok: true,
        value: undefined,
      });
      expect(harness.output()).toContain("database is untouched");

      expect(await harness.store.emails.countEmails(ACCOUNT.id)).toStrictEqual({
        ok: true,
        value: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("works even when nothing is connected", async () => {
    const harness = await createHarness({ connected: false });

    try {
      expect(await runCli(["logout"], harness.deps)).toBe(EXIT.ok);
    } finally {
      harness.close();
    }
  });
});

describe("init", () => {
  it("connects a mailbox from prompted credentials", async () => {
    const harness = await createHarness({
      connected: false,
      answers: ["client-xyz", "secret-xyz"],
    });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.ok);

      expect(harness.output()).toContain("Connected user@example.com");
      expect(harness.output()).toContain("keychain");
      expect(harness.output()).toContain("cleamail run --dry-run --since 7d");
      expect(harness.opened).toHaveLength(1);
      expect(harness.opened[0]).toContain("accounts.google.com");

      const stored = await loadClientCredentials(harness.secrets);
      expect(stored.ok && stored.value?.clientId).toBe("client-xyz");

      const token = await harness.tokens.get(ACCOUNT.id);
      expect(token.ok && token.value?.accessToken).toBe("at-new");

      const accounts = await harness.store.accounts.list();
      expect(accounts.ok && accounts.value).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("takes the client from the environment without prompting", async () => {
    const harness = await createHarness({
      connected: false,
      env: { CLEAMAIL_GOOGLE_CLIENT_ID: "env-client", CLEAMAIL_GOOGLE_CLIENT_SECRET: "env-secret" },
    });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.ok);

      const stored = await loadClientCredentials(harness.secrets);
      expect(stored.ok && stored.value?.clientId).toBe("env-client");
    } finally {
      harness.close();
    }
  });

  it("reuses a client already in the keychain", async () => {
    const harness = await createHarness({ connected: true });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("already in your keychain");
    } finally {
      harness.close();
    }
  });

  it("stops when no client ID is given", async () => {
    const harness = await createHarness({ connected: false, answers: ["", ""] });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.failure);
      expect(harness.errors()).toContain("client ID is required");

      const accounts = await harness.store.accounts.list();
      expect(accounts.ok && accounts.value).toHaveLength(0);
    } finally {
      harness.close();
    }
  });

  it("refuses a grant that came back with send access, and stores no token", async () => {
    const harness = await createHarness({
      connected: false,
      answers: ["client-xyz", ""],
      token: {
        accessToken: "at-wide",
        scopes: [
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/gmail.send",
        ],
      },
    });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.failure);
      expect(harness.errors()).toContain("gmail.send");
      expect(harness.errors()).toContain("Nothing was stored");

      expect(await harness.tokens.get(ACCOUNT.id)).toStrictEqual({ ok: true, value: undefined });
    } finally {
      harness.close();
    }
  });

  it("warns about a missing Ollama but still connects", async () => {
    const harness = await createHarness({
      connected: false,
      answers: ["client-xyz", ""],
      ollama: false,
    });

    try {
      expect(await runCli(["init"], harness.deps)).toBe(EXIT.ok);
      expect(harness.output()).toContain("not reachable");
      expect(harness.output()).toContain("install Ollama later");
    } finally {
      harness.close();
    }
  });
});
