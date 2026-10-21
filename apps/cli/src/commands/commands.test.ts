import { emailId, ok } from "@cleamail/core";
import { FakeClassifier } from "@cleamail/llm/testing";
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

  it("classifies what it fetched and prints the report", async () => {
    const harness = await createHarness({
      emails: [anEmail({ subject: "A question" }), anEmail({ id: emailId("msg-2") })],
    });

    try {
      expect(await runCli(["run", "--dry-run", "--since", "7d"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("Classifying 2 email(s) with qwen2.5:7b");
      expect(output).toContain("classified    2");
      expect(output).toContain("Nothing in your mailbox was changed.");
    } finally {
      harness.close();
    }
  });

  it("redacts the report when asked, printing no subject or sender", async () => {
    const harness = await createHarness({
      emails: [
        anEmail({
          subject: "Mortgage payment received",
          from: { address: "receipts@your-bank.example", name: "Your Bank" },
        }),
      ],
    });

    try {
      expect(await runCli(["run", "--redact"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("no subjects, senders or reasons");
      expect(output).toContain("classified    1");
      expect(output).not.toContain("Mortgage payment received");
      expect(output).not.toContain("receipts@your-bank.example");
    } finally {
      harness.close();
    }
  });

  it("fetches without waiting on a model when asked not to classify", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    try {
      expect(await runCli(["run", "--no-classify"], harness.deps)).toBe(EXIT.ok);

      expect(harness.output()).toContain("fetched   1");
      expect(harness.output()).toContain("Skipped classification");
      expect(harness.output()).not.toContain("classified");
    } finally {
      harness.close();
    }
  });

  it("fails the run when the model server cannot be built", async () => {
    const harness = await createHarness({
      emails: [anEmail()],
      classifier: {
        ok: false,
        error: { code: "config_invalid", message: "Ollama must run on this machine." },
      },
    });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.failure);

      expect(harness.errors()).toContain("Ollama must run on this machine.");
    } finally {
      harness.close();
    }
  });

  it("fails the run when the model server is unreachable, rather than reporting nothing", async () => {
    const harness = await createHarness({
      emails: [anEmail()],
      classifier: ok(new FakeClassifier({ failWith: "provider_unavailable" })),
    });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.failure);

      expect(harness.errors()).toContain("Could not classify:");
    } finally {
      harness.close();
    }
  });

  it("puts an email the model could not read into the review list and finishes", async () => {
    const harness = await createHarness({
      emails: [anEmail()],
      classifier: ok(new FakeClassifier({ failWith: "invalid_model_output" })),
    });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("needs review (1)");
      expect(output).toContain("model output invalid");
      expect(output).toContain("unreadable    1");
    } finally {
      harness.close();
    }
  });

  it("says there is nothing to classify for an empty window", async () => {
    const harness = await createHarness({ emails: [] });

    try {
      expect(await runCli(["run"], harness.deps)).toBe(EXIT.ok);

      expect(harness.output()).toContain("nothing to classify");
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
      expect(output).toContain("model      qwen2.5:7b");
      expect(output).not.toContain("not pulled yet");
    } finally {
      harness.close();
    }
  });

  it("says when the configured model has not been pulled, and how to pull it", async () => {
    const harness = await createHarness({
      classifierModel: "qwen3:8b",
      models: ["qwen3-vl:8b-instruct"],
    });

    try {
      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("model      qwen3:8b (not pulled yet)");
      expect(output).toContain("ollama pull qwen3:8b");
    } finally {
      harness.close();
    }
  });

  it("reports an unconnected mailbox without failing, and still shows the model", async () => {
    const harness = await createHarness({ connected: false });

    try {
      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);

      const output = harness.output();
      expect(output).toContain("mailbox    not connected");
      // Someone still setting up is exactly who needs the model lines.
      expect(output).toContain("ollama     running");
      expect(output).toContain("model      qwen2.5:7b");
      expect(output).toContain("Run `cleamail init` first.");
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

  it("asks Google for read-only access when told to, and says so first", async () => {
    const harness = await createHarness({ connected: false, answers: ["client-xyz", ""] });

    try {
      await runCli(["init", "--read-only"], harness.deps);

      const output = harness.output();
      expect(output).toContain("Read-only mode");
      expect(output).toContain("cannot change your mailbox");
      // What matters is the scope actually sent to Google, not the reassuring text above it.
      expect(output).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly");
      expect(output).not.toContain("gmail.modify");
    } finally {
      harness.close();
    }
  });

  it("asks for modify access by default", async () => {
    const harness = await createHarness({ connected: false, answers: ["client-xyz", ""] });

    try {
      await runCli(["init"], harness.deps);

      const output = harness.output();
      expect(output).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.modify");
      expect(output).not.toContain("Read-only mode");
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
