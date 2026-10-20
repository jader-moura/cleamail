import { describe, expect, it } from "vitest";
import { checkOllama, OLLAMA_DEFAULT_URL } from "./ollama.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("checkOllama", () => {
  it("asks localhost and lists the installed models", async () => {
    let requested = "";

    const result = await checkOllama(OLLAMA_DEFAULT_URL, (url) => {
      requested = typeof url === "string" ? url : "";

      return Promise.resolve(jsonResponse({ models: [{ name: "qwen2.5:7b" }] }));
    });

    expect(new URL(requested).hostname).toBe("localhost");
    expect(result).toStrictEqual({ ok: true, value: ["qwen2.5:7b"] });
  });

  it("treats an empty model list as running", async () => {
    const result = await checkOllama(OLLAMA_DEFAULT_URL, () => Promise.resolve(jsonResponse({})));

    expect(result).toStrictEqual({ ok: true, value: [] });
  });

  it("explains how to fix an unreachable server", async () => {
    const result = await checkOllama(OLLAMA_DEFAULT_URL, () =>
      Promise.reject(new Error("ECONNREFUSED")),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("provider_unavailable");
    expect(result.error.message).toContain("ollama.com");
  });

  it("reports a bad status", async () => {
    const result = await checkOllama(OLLAMA_DEFAULT_URL, () =>
      Promise.resolve(jsonResponse({}, 500)),
    );

    expect(result.ok).toBe(false);
  });

  it("reports a response it cannot read", async () => {
    const result = await checkOllama(OLLAMA_DEFAULT_URL, () =>
      Promise.resolve(jsonResponse({ models: "all of them" })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("cannot read");
  });
});
