import { describe, expect, it } from "vitest";
import { email } from "../test/emails.js";
import { modelReply, stubOllama, type StubReply } from "../testing/stub-ollama.js";
import { OLLAMA_REQUEST_TIMEOUT_MS } from "./client.js";
import { DEFAULT_CLASSIFIER_MODEL, OllamaClassificationModel } from "./model.js";
import { CLASSIFICATION_JSON_SCHEMA } from "./schema.js";

const GOOD = {
  category: "promotion",
  importance: 0.1,
  confidence: 0.9,
  reason: "A marketing message announcing a sale.",
};

function modelWith(replies: readonly StubReply[], model = "test-model") {
  const stub = stubOllama({ replies });
  const created = OllamaClassificationModel.create({ fetch: stub.fetch, model });

  if (!created.ok) throw new Error(created.error.message);

  return { stub, model: created.value };
}

describe("OllamaClassificationModel.create", () => {
  it("defaults to the documented model and prompt version", () => {
    const created = OllamaClassificationModel.create();

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.model).toBe(DEFAULT_CLASSIFIER_MODEL);
    expect(created.value.promptVersion).toBe("v1");
  });

  it("refuses a base URL that is not on this machine, before any request", () => {
    const stub = stubOllama({});
    const created = OllamaClassificationModel.create({
      baseUrl: "https://ollama.example.com",
      fetch: stub.fetch,
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;

    expect(created.error.code).toBe("config_invalid");
    expect(stub.chatRequests).toHaveLength(0);
  });

  it("accepts the loopback forms", () => {
    for (const baseUrl of [
      "http://localhost:11434",
      "http://127.0.0.1:11434",
      "http://[::1]:11434",
    ]) {
      expect(OllamaClassificationModel.create({ baseUrl }).ok).toBe(true);
    }
  });
});

describe("the request sent to Ollama", () => {
  it("carries no tools or functions, so the classifier cannot be given any", async () => {
    const { stub, model } = modelWith([modelReply(GOOD)]);
    await model.complete({ email: email() });

    const [request] = stub.chatRequests;
    expect(request).toBeDefined();
    if (request === undefined) return;

    expect(request.body).not.toHaveProperty("tools");
    expect(request.body).not.toHaveProperty("functions");
    expect(request.body).not.toHaveProperty("tool_choice");
    expect(Object.keys(request.body).sort()).toStrictEqual([
      "format",
      "keep_alive",
      "messages",
      "model",
      "options",
      "stream",
    ]);
  });

  it("constrains the output with the schema generated from Zod", async () => {
    const { stub, model } = modelWith([modelReply(GOOD)]);
    await model.complete({ email: email() });

    expect(stub.chatRequests[0]?.body["format"]).toStrictEqual(CLASSIFICATION_JSON_SCHEMA);
  });

  it("asks for a deterministic answer", async () => {
    const { stub, model } = modelWith([modelReply(GOOD)]);
    await model.complete({ email: email() });

    expect(stub.chatRequests[0]?.body["options"]).toMatchObject({ temperature: 0, seed: 1 });
  });

  it("does not stream, and uses the configured model name", async () => {
    const { stub, model } = modelWith([modelReply(GOOD)], "qwen3-vl:8b-instruct");
    await model.complete({ email: email() });

    expect(stub.chatRequests[0]?.body["stream"]).toBe(false);
    expect(stub.chatRequests[0]?.body["model"]).toBe("qwen3-vl:8b-instruct");
  });

  it("sends the instructions as a system message and the email as a user message", async () => {
    const { stub, model } = modelWith([modelReply(GOOD)]);
    await model.complete({ email: email({ subject: "Receipt 99" }) });

    const { system, user } = stub.lastMessages();
    expect(system).toContain("You do not decide what happens to the email");
    expect(system).not.toContain("Receipt 99");
    expect(user).toContain("Receipt 99");
  });
});

describe("reading the answer", () => {
  it("returns a validated classification for a well-formed reply", async () => {
    const { model } = modelWith([modelReply(GOOD)]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toStrictEqual(GOOD);
  });

  it("tolerates a markdown fence around the object", async () => {
    const { model } = modelWith([
      { kind: "content", content: `\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`` },
    ]);

    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["prose instead of JSON", "I think this is a promotion."],
    ["a category outside the fixed set", JSON.stringify({ ...GOOD, category: "spam" })],
    ["a score out of range", JSON.stringify({ ...GOOD, confidence: 1.4 })],
    ["a negative score", JSON.stringify({ ...GOOD, importance: -0.1 })],
    ["an empty reason", JSON.stringify({ ...GOOD, reason: "   " })],
    ["a missing field", JSON.stringify({ category: "fyi", importance: 0.5, confidence: 0.5 })],
    ["a JSON array", JSON.stringify([GOOD])],
    ["a bare string", JSON.stringify("promotion")],
  ])("rejects %s as invalid_model_output", async (_name, content) => {
    const { model } = modelWith([{ kind: "content", content }]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_model_output");
  });

  it("never puts the rejected value in the error message, which gets logged", async () => {
    const secret = "mortgage account 4455 6677";
    const { model } = modelWith([
      { kind: "content", content: JSON.stringify({ ...GOOD, confidence: 9, reason: secret }) },
    ]);

    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.message).not.toContain(secret);
    expect(result.error.message).toContain("confidence");
  });

  it("rejects a reply envelope it cannot read", async () => {
    const { model } = modelWith([{ kind: "raw", payload: { message: "not an object" } }]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_model_output");
  });
});

describe("when Ollama is unhappy", () => {
  it("reports an unreachable server with instructions", async () => {
    const { model } = modelWith([{ kind: "offline" }]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("provider_unavailable");
    expect(result.error.message).toContain("ollama.com");
  });

  it("turns a 404 into advice to pull the model", async () => {
    const { model } = modelWith([{ kind: "status", status: 404, body: "model not found" }]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("not_found");
    expect(result.error.message).toContain("ollama pull");
  });

  it.each([
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ])("maps status %i to %s", async (status, code) => {
    const { model } = modelWith([{ kind: "status", status }]);
    const result = await model.complete({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(code);
  });

  it("allows enough time for a cold model load", () => {
    // Measured at 58 seconds for a first call against an 8B model, about 1 second warm.
    expect(OLLAMA_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
