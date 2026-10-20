import { installNetworkGuard, type NetworkGuard } from "@cleamail/privacy";
import { emailId } from "@cleamail/core";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import { EXIT } from "./exit.js";
import { anEmail, createHarness } from "./test/harness.js";

/**
 * The CLI's own privacy check.
 *
 * A fetch and a store should involve the mail provider and nothing else, so with the provider
 * faked, a whole run should make no outbound call at all. If an update check, a crash reporter or
 * an analytics ping ever appears in this app, this test is what notices.
 */
describe("the CLI under the privacy guard", () => {
  let guard: NetworkGuard | undefined;

  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });

  it("makes no outbound call while fetching and storing mail", async () => {
    const harness = await createHarness({
      emails: [anEmail(), anEmail({ id: emailId("msg-2") })],
    });

    guard = installNetworkGuard();

    try {
      expect(await runCli(["run", "--since", "7d"], harness.deps)).toBe(EXIT.ok);

      expect(guard.attempts).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });

  it("makes no outbound call while reporting status", async () => {
    const harness = await createHarness({ emails: [anEmail()] });

    guard = installNetworkGuard();

    try {
      expect(await runCli(["status"], harness.deps)).toBe(EXIT.ok);

      expect(guard.violations).toStrictEqual([]);
    } finally {
      harness.close();
    }
  });
});
