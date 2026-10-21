import { describe, expect, it } from "vitest";
import { normalizeHeaders } from "../domain/headers.js";
import { accountId, emailId, threadId } from "../domain/ids.js";
import type { Email } from "../domain/email.js";
import type { ClassificationRequest, EmailClassifier } from "../ports/classifier.js";
import { failure, ok, type Result } from "../result.js";
import type { Classification } from "../domain/classification.js";
import type { RuleContext } from "../rules/types.js";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  classifyEmail,
  classifyEmails,
  toClassifiable,
} from "./classify.js";

const ACCOUNT = "user@example.com";
const context: RuleContext = { accountAddress: ACCOUNT };

function anEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: emailId("m1"),
    threadId: threadId("t1"),
    accountId: accountId(ACCOUNT),
    from: { address: "someone@example.org", name: "Someone" },
    to: [{ address: ACCOUNT }],
    cc: [],
    subject: "A question",
    snippet: "hi",
    bodyText: "Could you confirm the date?",
    headers: {},
    providerLabels: ["INBOX"],
    isRead: false,
    isStarred: false,
    isInInbox: true,
    receivedAt: new Date("2026-10-18T10:00:00.000Z"),
    sizeBytes: 100,
    ...overrides,
  };
}

/** A classifier that answers however the test needs, and records whether it was asked at all. */
function classifierThat(
  answer: (request: ClassificationRequest) => Result<Classification>,
): EmailClassifier & { readonly calls: ClassificationRequest[] } {
  const calls: ClassificationRequest[] = [];

  return {
    name: "test-model",
    calls,
    classify: (request) => {
      calls.push(request);

      return Promise.resolve(answer(request));
    },
  };
}

function answers(overrides: Partial<Classification> = {}): Result<Classification> {
  return ok({
    category: "fyi",
    importance: 0.4,
    confidence: 0.9,
    reason: "A plain message.",
    source: "model",
    model: "test-model",
    ...overrides,
  });
}

describe("toClassifiable", () => {
  it("passes on only the fields the classifier is allowed to see", () => {
    const result = toClassifiable(anEmail());

    expect(Object.keys(result).sort()).toStrictEqual([
      "bodyText",
      "from",
      "headers",
      "id",
      "providerLabels",
      "snippet",
      "subject",
      "to",
    ]);
  });
});

describe("classifyEmail", () => {
  it("uses the model when no rule is terminal, and passes the hints along", async () => {
    const classifier = classifierThat(() => answers());

    const result = await classifyEmail(
      anEmail({
        headers: normalizeHeaders([{ name: "List-Unsubscribe", value: "<mailto:x@y.example>" }]),
      }),
      { classifier, context },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.classification?.source).toBe("model");
    expect(classifier.calls).toHaveLength(1);
    expect(classifier.calls[0]?.hints?.map((hint) => hint.id)).toContain("has_unsubscribe_link");
  });

  it("skips the model entirely when a rule settles it", async () => {
    const classifier = classifierThat(() => answers());

    const result = await classifyEmail(anEmail({ providerLabels: ["CATEGORY_PROMOTIONS"] }), {
      classifier,
      context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.classification?.source).toBe("rule");
    expect(result.value.classification?.ruleId).toBe("gmail_category_promotions");
    expect(classifier.calls).toStrictEqual([]);
  });

  it("sends an email to review when the model is unsure", async () => {
    const classifier = classifierThat(() => answers({ confidence: 0.4 }));
    const result = await classifyEmail(anEmail(), { classifier, context });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.reviewReason).toBe("low_confidence");
    expect(result.value.classification).toBeDefined();
  });

  it("respects a threshold the caller sets", async () => {
    const classifier = classifierThat(() => answers({ confidence: 0.7 }));

    const lenient = await classifyEmail(anEmail(), { classifier, context });
    const strict = await classifyEmail(anEmail(), {
      classifier,
      context,
      confidenceThreshold: 0.8,
    });

    expect(lenient.ok && lenient.value.reviewReason).toBeUndefined();
    expect(strict.ok && strict.value.reviewReason).toBe("low_confidence");
  });

  it("uses the same threshold the prompt tells the model about", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it("sends anything suspicious to review, however confident the model was", async () => {
    const classifier = classifierThat(() => answers({ category: "suspicious", confidence: 0.99 }));
    const result = await classifyEmail(anEmail(), { classifier, context });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.reviewReason).toBe("suspicious");
  });

  it("sends a rule match to review too when the rule is suspicious", async () => {
    const classifier = classifierThat(() => answers());

    const result = await classifyEmail(
      anEmail({
        headers: normalizeHeaders([
          { name: "Authentication-Results", value: "mx.example; dmarc=fail" },
        ]),
      }),
      { classifier, context },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.classification?.category).toBe("suspicious");
    expect(result.value.reviewReason).toBe("suspicious");
    expect(classifier.calls).toStrictEqual([]);
  });

  it("reports invalid model output as a review item without inventing a category", async () => {
    const classifier = classifierThat(() => failure("invalid_model_output", "not JSON"));
    const result = await classifyEmail(anEmail(), { classifier, context });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.reviewReason).toBe("invalid_model_output");
    // Kept so a report can say why rather than only how many.
    expect(result.value.reviewDetail).toBe("not JSON");
    expect(result.value.classification).toBeUndefined();
  });

  it("fails the whole call when the model server cannot be reached", async () => {
    const classifier = classifierThat(() => failure("provider_unavailable", "Ollama is down."));
    const result = await classifyEmail(anEmail(), { classifier, context });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("provider_unavailable");
  });
});

describe("classifyEmails", () => {
  it("classifies in order and reports progress", async () => {
    const classifier = classifierThat(() => answers());
    const progress: number[] = [];

    const result = await classifyEmails(
      [anEmail({ id: emailId("a") }), anEmail({ id: emailId("b") })],
      {
        classifier,
        context,
        onProgress: (done) => progress.push(done),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map((outcome) => outcome.emailId)).toStrictEqual(["a", "b"]);
    expect(progress).toStrictEqual([1, 2]);
  });

  it("keeps going when one email produces invalid output", async () => {
    let call = 0;
    const classifier = classifierThat(() => {
      call += 1;

      return call === 1 ? failure("invalid_model_output", "no") : answers();
    });

    const result = await classifyEmails(
      [anEmail({ id: emailId("a") }), anEmail({ id: emailId("b") })],
      { classifier, context },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value[0]?.reviewReason).toBe("invalid_model_output");
    expect(result.value[1]?.classification).toBeDefined();
  });

  it("stops at the first unreachable-server error rather than repeating it", async () => {
    const classifier = classifierThat(() => failure("provider_unavailable", "down"));

    const result = await classifyEmails(
      [anEmail({ id: emailId("a") }), anEmail({ id: emailId("b") })],
      { classifier, context },
    );

    expect(result.ok).toBe(false);
    expect(classifier.calls).toHaveLength(1);
  });

  it("returns nothing for an empty batch", async () => {
    const classifier = classifierThat(() => answers());
    const result = await classifyEmails([], { classifier, context });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toStrictEqual([]);
  });
});
