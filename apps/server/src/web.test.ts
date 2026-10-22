import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_PORT } from "./config.js";
import { resolveWebDir } from "./web.js";
import { LOCAL_HEADERS, createServerHarness, type ServerHarness } from "./test/harness.js";

describe("serving the dashboard", () => {
  let harness: ServerHarness;
  let webDir: string;

  beforeEach(async () => {
    harness = await createServerHarness();

    webDir = mkdtempSync(join(tmpdir(), "cleamail-web-"));
    mkdirSync(join(webDir, "assets"), { recursive: true });
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>cleamail</title>");
    writeFileSync(join(webDir, "assets", "app.js"), "export const hello = 1;");
  });

  afterEach(async () => {
    await harness.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it("serves the page at the root", async () => {
    const app = createApp(harness.deps, { port: DEFAULT_PORT, webDir });
    await app.ready();

    try {
      const response = await app.inject({ method: "GET", url: "/", headers: LOCAL_HEADERS });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("cleamail");
    } finally {
      await app.close();
    }
  });

  it("serves the assets next to it", async () => {
    const app = createApp(harness.deps, { port: DEFAULT_PORT, webDir });
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/assets/app.js",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("hello");
    } finally {
      await app.close();
    }
  });

  it("keeps the API answering, so a path cannot be shadowed by a file", async () => {
    writeFileSync(join(webDir, "api"), "not the api");

    const app = createApp(harness.deps, { port: DEFAULT_PORT, webDir });
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: LOCAL_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("refuses to walk out of the directory it was given", async () => {
    const secret = join(webDir, "..", "secret.txt");
    writeFileSync(secret, "a token, hypothetically");

    const app = createApp(harness.deps, { port: DEFAULT_PORT, webDir });
    await app.ready();

    try {
      for (const url of ["/../secret.txt", "/..%2Fsecret.txt", "/assets/../../secret.txt"]) {
        const response = await app.inject({ method: "GET", url, headers: LOCAL_HEADERS });

        expect(response.statusCode, url).not.toBe(200);
        expect(response.body, url).not.toContain("hypothetically");
      }
    } finally {
      await app.close();
      rmSync(secret, { force: true });
    }
  });

  it("still checks the Host header on a page request", async () => {
    const app = createApp(harness.deps, { port: DEFAULT_PORT, webDir });
    await app.ready();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/",
        headers: { host: "your-inbox.example" },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("says the app is not built rather than failing to start", async () => {
    const app = createApp(harness.deps, { port: DEFAULT_PORT });
    await app.ready();

    try {
      const page = await app.inject({ method: "GET", url: "/", headers: LOCAL_HEADERS });
      const api = await app.inject({ method: "GET", url: "/api/health", headers: LOCAL_HEADERS });

      expect(page.statusCode).toBe(503);
      expect(page.body).toContain("has not been built yet");
      // The API is useful on its own, which is the point of not failing the startup.
      expect(api.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("resolveWebDir", () => {
  it("takes a directory from the environment when it holds a page", () => {
    const dir = mkdtempSync(join(tmpdir(), "cleamail-web-env-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html>");

    try {
      expect(resolveWebDir({ CLEAMAIL_WEB_DIR: dir })).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports nothing when the directory has no page in it", () => {
    const empty = mkdtempSync(join(tmpdir(), "cleamail-web-empty-"));

    try {
      expect(resolveWebDir({ CLEAMAIL_WEB_DIR: empty })).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("treats an empty setting as unset", () => {
    expect(resolveWebDir({ CLEAMAIL_WEB_DIR: "   " })).toBe(resolveWebDir({}));
  });
});
