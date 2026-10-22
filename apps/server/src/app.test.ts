import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PORT, HOST, readConfig } from "./config.js";
import { LOCAL_HEADERS, createServerHarness, type ServerHarness } from "./test/harness.js";

describe("the Host check", () => {
  let harness: ServerHarness;

  beforeEach(async () => {
    harness = await createServerHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function health(host: string | undefined): Promise<number> {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/health",
      ...(host === undefined ? {} : { headers: { host } }),
    });

    return response.statusCode;
  }

  it("answers a request addressed to it on this machine", async () => {
    expect(await health(`127.0.0.1:${String(DEFAULT_PORT)}`)).toBe(200);
    expect(await health(`localhost:${String(DEFAULT_PORT)}`)).toBe(200);
    expect(await health("localhost")).toBe(200);
  });

  it("refuses a request addressed to someone else's hostname", async () => {
    // What a page the user is visiting would send: its own hostname, pointed at 127.0.0.1. The
    // browser sends the request happily, and this header is the only thing that tells them apart.
    expect(await health("your-inbox.example")).toBe(403);
    expect(await health("your-inbox.example:4571")).toBe(403);
    expect(await health("192.168.1.20:4571")).toBe(403);
  });

  it("refuses a loopback name on a port this server is not on", async () => {
    expect(await health("127.0.0.1:9999")).toBe(403);
  });

  it("refuses a request with no Host at all", async () => {
    expect(await health(undefined)).toBe(403);
  });

  it("says why, in the same shape as every other error", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "your-inbox.example" },
    });

    expect(response.json<{ error: { code: string } }>().error.code).toBe("not_allowed");
  });

  it("refuses before the route runs, so a write cannot slip past it", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/undo",
      headers: { host: "your-inbox.example" },
      payload: {},
    });

    expect(response.statusCode).toBe(403);

    const audit = await harness.store.audit.list();

    // Nothing was attempted, so nothing was written down.
    expect(audit.ok && audit.value).toStrictEqual([]);
  });

  it("lets a request through when the port matches", async () => {
    expect(await health(LOCAL_HEADERS.host)).toBe(200);
  });
});

describe("readConfig", () => {
  it("defaults to the documented port on loopback", () => {
    expect(readConfig({})).toStrictEqual({
      ok: true,
      value: { host: HOST, port: DEFAULT_PORT },
    });
  });

  it("takes a port from the environment", () => {
    expect(readConfig({ CLEAMAIL_PORT: "5055" })).toStrictEqual({
      ok: true,
      value: { host: HOST, port: 5055 },
    });
  });

  it("treats an empty value as unset", () => {
    expect(readConfig({ CLEAMAIL_PORT: "  " })).toStrictEqual({
      ok: true,
      value: { host: HOST, port: DEFAULT_PORT },
    });
  });

  it("refuses a port it cannot use, rather than failing at listen", () => {
    for (const value of ["0", "80", "70000", "many", "-1", "4571.5"]) {
      const result = readConfig({ CLEAMAIL_PORT: value });

      expect(result.ok, value).toBe(false);
      expect(!result.ok && result.error.message).toContain("CLEAMAIL_PORT");
    }
  });

  it("never offers a host to configure", () => {
    const result = readConfig({ CLEAMAIL_HOST: "0.0.0.0" });

    expect(result.ok && result.value.host).toBe("127.0.0.1");
  });
});
