import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "./start.js";
import { createServerHarness, type ServerHarness } from "./test/harness.js";

/**
 * The one test that uses a real socket.
 *
 * Everything else is `inject`, which proves what the routes do. This proves where the server can be
 * reached from, which no amount of route testing can show.
 */
describe("startServer", () => {
  let harness: ServerHarness | undefined;
  let running: RunningServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
    await harness?.close();
    harness = undefined;
  });

  it("listens on loopback and nowhere else", async () => {
    harness = await createServerHarness();

    // Port 0 lets the operating system pick, so the test never collides with a real cleamail.
    const started = await startServer(harness.deps, { port: 0 });

    expect(started.ok).toBe(true);
    if (!started.ok) return;

    running = started.value;

    const address = started.value.app.addresses()[0];

    expect(address?.address).toBe("127.0.0.1");
    expect(address?.family).toBe("IPv4");
    expect(started.value.url).toContain("http://127.0.0.1:");
  });

  it("answers over that socket", async () => {
    harness = await createServerHarness();

    const started = await startServer(harness.deps, { port: 0 });
    if (!started.ok) throw new Error(started.error.message);

    running = started.value;

    const response = await fetch(`${started.value.url}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("refuses a request that addresses it by another name over the real socket", async () => {
    harness = await createServerHarness();

    const started = await startServer(harness.deps, { port: 0 });
    if (!started.ok) throw new Error(started.error.message);

    running = started.value;

    // `fetch` refuses to set a Host header, so this goes through the raw client: a browser pointed
    // at a hostname that resolves to 127.0.0.1 would send exactly this.
    const status = await statusWithHost(started.value.port, "your-inbox.example");

    expect(status).toBe(403);
  });

  it("answers the same socket when the Host is a loopback name", async () => {
    harness = await createServerHarness();

    const started = await startServer(harness.deps, { port: 0 });
    if (!started.ok) throw new Error(started.error.message);

    running = started.value;

    expect(
      await statusWithHost(started.value.port, `localhost:${String(started.value.port)}`),
    ).toBe(200);
  });

  it("says plainly when the port is already taken", async () => {
    harness = await createServerHarness();

    const first = await startServer(harness.deps, { port: 0 });
    if (!first.ok) throw new Error(first.error.message);

    running = first.value;

    const second = await startServer(harness.deps, { port: first.value.port });

    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.message).toContain("Another program may be using that port");
  });
});

/** One request with a Host header of our choosing, which `fetch` will not send. */
function statusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/api/health", method: "GET", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );

    req.on("error", reject);
    req.end();
  });
}
