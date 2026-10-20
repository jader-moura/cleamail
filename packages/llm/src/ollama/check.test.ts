import { describe, expect, it } from "vitest";
import { isLoopbackUrl, resolveOllamaUrl } from "../hosts.js";
import { stubOllama } from "../testing/stub-ollama.js";
import { checkOllama, hasModel } from "./check.js";

describe("checkOllama", () => {
  it("lists the installed models", async () => {
    const stub = stubOllama({ models: ["qwen2.5:7b", "nomic-embed-text:latest"] });
    const result = await checkOllama({ fetch: stub.fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toStrictEqual(["qwen2.5:7b", "nomic-embed-text:latest"]);
  });

  it("reports an empty Ollama without failing", async () => {
    const result = await checkOllama({ fetch: stubOllama({ models: [] }).fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toStrictEqual([]);
  });

  it("explains how to install Ollama when it is not running", async () => {
    const result = await checkOllama({
      fetch: () => {
        throw new Error("ECONNREFUSED");
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("provider_unavailable");
    expect(result.error.message).toContain("ollama.com");
  });

  it("refuses a remote Ollama", async () => {
    const result = await checkOllama({ baseUrl: "http://ollama.example.com" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("config_invalid");
  });
});

describe("hasModel", () => {
  const installed = ["qwen3-vl:8b-instruct", "qwen3:14b", "minicpm-v:latest"];

  it("matches an exact tag", () => {
    expect(hasModel(installed, "qwen3:14b")).toBe(true);
    expect(hasModel(installed, "qwen3-vl:8b-instruct")).toBe(true);
  });

  it("treats a missing tag as :latest, the way Ollama reports it", () => {
    expect(hasModel(installed, "minicpm-v")).toBe(true);
  });

  it("does not match a different tag of the same model", () => {
    expect(hasModel(installed, "qwen3-vl:8b")).toBe(false);
    expect(hasModel(installed, "qwen3:8b")).toBe(false);
  });

  it("does not match a prefix", () => {
    expect(hasModel(installed, "qwen3")).toBe(false);
    expect(hasModel([], "qwen2.5:7b")).toBe(false);
  });
});

describe("the loopback check", () => {
  it.each([
    ["http://localhost:11434", true],
    ["http://127.0.0.1:11434", true],
    ["http://[::1]:11434", true],
    ["http://0.0.0.0:11434", true],
    ["https://ollama.example.com", false],
    ["http://10.0.0.5:11434", false],
    ["http://localhost.evil.example", false],
    ["not a url", false],
    ["", false],
  ])("%s is loopback: %s", (candidate, expected) => {
    expect(isLoopbackUrl(candidate)).toBe(expected);
  });

  it("strips a trailing slash so paths do not double up", () => {
    const result = resolveOllamaUrl("http://localhost:11434/");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe("http://localhost:11434");
  });

  it("says why a remote host is refused, in terms of the promise it would break", () => {
    const result = resolveOllamaUrl("https://api.example.com");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.message).toContain("will not send email content");
  });
});
