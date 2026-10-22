import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { EXIT } from "./exit.js";
import { createHarness, type Harness } from "./test/harness.js";
import { VERSION } from "./version.js";

describe("runCli", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it("shows help with no arguments", async () => {
    expect(await runCli([], harness.deps)).toBe(EXIT.ok);
    expect(harness.output()).toContain("Usage");
    expect(harness.output()).toContain("Everything runs on your machine");
  });

  it("shows help on --help and help", async () => {
    expect(await runCli(["--help"], harness.deps)).toBe(EXIT.ok);
    expect(await runCli(["help"], harness.deps)).toBe(EXIT.ok);
  });

  it("prints the version", async () => {
    expect(await runCli(["--version"], harness.deps)).toBe(EXIT.ok);
    expect(harness.output()).toContain(VERSION);
  });

  it("rejects an unknown command with a usage code", async () => {
    expect(await runCli(["sort-my-inbox"], harness.deps)).toBe(EXIT.usage);
    expect(harness.errors()).toContain("Unknown command");
  });

  it("says plainly when a command belongs to a later phase", async () => {
    for (const command of ["start", "eval"]) {
      const fresh = await createHarness();

      try {
        expect(await runCli([command], fresh.deps)).toBe(EXIT.failure);
        expect(fresh.errors()).toContain("not available yet");
      } finally {
        fresh.close();
      }
    }
  });

  it("rejects an unreadable --max", async () => {
    expect(await runCli(["run", "--max", "0"], harness.deps)).toBe(EXIT.usage);
    expect(await runCli(["run", "--max", "9000"], harness.deps)).toBe(EXIT.usage);
    expect(await runCli(["run", "--max", "many"], harness.deps)).toBe(EXIT.usage);
    expect(harness.errors()).toContain("--max must be a whole number");
  });

  it("rejects an unknown flag instead of ignoring it", async () => {
    expect(await runCli(["run", "--everything"], harness.deps)).toBe(EXIT.usage);
  });

  it("accepts --dry-run, which is implied in this phase", async () => {
    expect(await runCli(["run", "--dry-run"], harness.deps)).toBe(EXIT.ok);
  });

  it("ignores the separator pnpm forwards in dev", async () => {
    expect(await runCli(["--", "status"], harness.deps)).toBe(EXIT.ok);
    expect(harness.output()).toContain("mailbox    user@example.com");
  });
});
