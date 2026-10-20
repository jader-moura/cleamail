import { failure, ok, type ClassificationModel } from "@cleamail/core";
import { describe, expect, it } from "vitest";
import { ModelBackedClassifier, createOllamaClassifier } from "./classifier.js";
import { email } from "./test/emails.js";
import { FakeClassifier } from "./testing/fake-classifier.js";
import { modelReply, stubOllama } from "./testing/stub-ollama.js";

const RAW = {
  category: "newsletter",
  importance: 0.2,
  confidence: 0.85,
  reason: "A weekly digest the user subscribed to.",
} as const;

function fixedModel(name = "test-model"): ClassificationModel {
  return {
    model: name,
    complete: () => Promise.resolve(ok({ ...RAW })),
  };
}

describe("ModelBackedClassifier", () => {
  it("attaches source and model, which the model itself never provides", async () => {
    const result = await new ModelBackedClassifier(fixedModel()).classify({ email: email() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toStrictEqual({ ...RAW, source: "model", model: "test-model" });
  });

  it("takes its name from the model, so logs say which one answered", () => {
    expect(new ModelBackedClassifier(fixedModel("qwen3:14b")).name).toBe("qwen3:14b");
  });

  it("passes a model failure through untouched", async () => {
    const broken: ClassificationModel = {
      model: "test-model",
      complete: () => Promise.resolve(failure("provider_unavailable", "Ollama is not running.")),
    };

    const result = await new ModelBackedClassifier(broken).classify({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("provider_unavailable");
  });

  it("fails rather than emit a classification it cannot validate", async () => {
    // A model whose `model` name is empty would produce a Classification that fails the schema.
    const nameless: ClassificationModel = {
      model: "",
      complete: () => Promise.resolve(ok({ ...RAW })),
    };

    const result = await new ModelBackedClassifier(nameless).classify({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_model_output");
  });

  it("forwards hints and examples to the model", async () => {
    const seen: unknown[] = [];
    const recording: ClassificationModel = {
      model: "test-model",
      complete: (request) => {
        seen.push(request.hints);
        return Promise.resolve(ok({ ...RAW }));
      },
    };

    await new ModelBackedClassifier(recording).classify({
      email: email(),
      hints: [{ id: "bulk_headers", detail: "Mailing list." }],
    });

    expect(seen[0]).toStrictEqual([{ id: "bulk_headers", detail: "Mailing list." }]);
  });
});

describe("createOllamaClassifier", () => {
  it("builds a working classifier over a recorded Ollama", async () => {
    const stub = stubOllama({ replies: [modelReply({ ...RAW })] });
    const classifier = createOllamaClassifier({ fetch: stub.fetch, model: "test-model" });

    expect(classifier.ok).toBe(true);
    if (!classifier.ok) return;

    const result = await classifier.value.classify({ email: email() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.category).toBe("newsletter");
    expect(result.value.source).toBe("model");
  });

  it("refuses a non-loopback host", () => {
    const classifier = createOllamaClassifier({ baseUrl: "http://ollama.example.com" });

    expect(classifier.ok).toBe(false);
    if (classifier.ok) return;

    expect(classifier.error.code).toBe("config_invalid");
  });
});

describe("FakeClassifier", () => {
  it("answers predictably and records what it was asked", async () => {
    const fake = new FakeClassifier({ category: "important", confidence: 0.95 });
    const result = await fake.classify({ email: email() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.category).toBe("important");
    expect(result.value.source).toBe("model");
    expect(fake.requests).toHaveLength(1);
  });

  it("can be told to fail, for testing the fallback to review", async () => {
    const fake = new FakeClassifier({ failWith: "invalid_model_output" });
    const result = await fake.classify({ email: email() });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("invalid_model_output");
  });
});
