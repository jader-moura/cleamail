import { installNetworkGuard, type NetworkGuard } from "@cleamail/privacy";
import { emailId } from "@cleamail/core";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { LOCAL_HEADERS, anEmail, createServerHarness, type ServerHarness } from "./test/harness.js";

/**
 * The server's own privacy check.
 *
 * A local API that reads the database and reverses actions has no reason to reach the network at
 * all, and the only host it may ever touch is the mail provider. If an update check or a telemetry
 * ping ever appears in this app, this is what notices.
 */
describe("the server under the privacy guard", () => {
  let guard: NetworkGuard | undefined;
  let harness: ServerHarness | undefined;

  afterEach(async () => {
    guard?.restore();
    guard = undefined;
    await harness?.close();
    harness = undefined;
  });

  it("serves every route without making an outbound call", async () => {
    harness = await createServerHarness({ emails: [anEmail()] });
    await harness.applyRun("run-1", [anEmail()]);

    guard = installNetworkGuard();

    for (const url of ["/api/health", "/api/status", "/api/decisions", "/api/audit"]) {
      const response = await harness.app.inject({ method: "GET", url, headers: LOCAL_HEADERS });

      expect(response.statusCode, url).toBe(200);
    }

    const undone = await harness.app.inject({
      method: "POST",
      url: "/api/undo",
      headers: LOCAL_HEADERS,
      payload: {},
    });

    expect(undone.statusCode).toBe(200);
    expect(guard.attempts).toStrictEqual([]);
  });

  it("starts and stops without reaching the network at all", async () => {
    harness = await createServerHarness({ emails: [anEmail({ id: emailId("msg-1") })] });

    // The guard refuses every live connection by design, including a loopback one, so a listening
    // socket cannot run under it: `listen` resolves its host through DNS and would be blocked.
    // What it can prove is the part that matters, that building and tearing the app down reaches
    // nowhere, and `start.test.ts` covers the socket itself.
    guard = installNetworkGuard();

    const app = createApp(harness.deps, { port: 4571 });
    await app.ready();
    await app.close();

    expect(guard.attempts).toStrictEqual([]);
  });
});
