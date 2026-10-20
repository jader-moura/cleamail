import { OllamaChatResponseSchema } from "../ollama/types.js";

/**
 * A recorded Ollama, as a `fetch` implementation.
 *
 * CLAUDE.md forbids calling a real model in unit tests, so every test in this package drives the
 * adapter through this. It also keeps the exact request bodies, which is how the "the classifier has
 * no tools" claim is asserted rather than described.
 */
export type StubReply =
  /** An assistant message with this content, wrapped in a well-formed Ollama envelope. */
  | { readonly kind: "content"; readonly content: string }
  /** A complete `/api/chat` payload, for testing a malformed envelope. */
  | { readonly kind: "raw"; readonly payload: unknown }
  /** An HTTP failure. */
  | { readonly kind: "status"; readonly status: number; readonly body?: string }
  /** A transport failure, as if Ollama were not running. */
  | { readonly kind: "offline" };

export type StubRequest = {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
};

export type StubOllamaOptions = {
  /** Consumed in order. The last one repeats once the list runs out. */
  readonly replies?: readonly StubReply[];
  /** What `/api/tags` reports. */
  readonly models?: readonly string[];
};

export type StubOllama = {
  readonly fetch: typeof globalThis.fetch;
  /** Every `/api/chat` request, in order. */
  readonly chatRequests: readonly StubRequest[];
  /** Convenience accessor for the system and user messages of the last chat request. */
  lastMessages(): { readonly system: string; readonly user: string };
};

export function stubOllama(options: StubOllamaOptions = {}): StubOllama {
  const replies = options.replies ?? [{ kind: "content", content: "{}" }];
  const chatRequests: StubRequest[] = [];
  let index = 0;

  // Not `async`: `respond` is synchronous, including the throw that stands in for a dead server,
  // and an async wrapper would only turn that throw into a rejection one tick later.
  const fetchImpl = (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const url = urlOf(input);

    if (url.endsWith("/api/tags")) {
      return Promise.resolve(
        jsonResponse({ models: (options.models ?? []).map((name) => ({ name })) }),
      );
    }

    chatRequests.push({
      url,
      method: init?.method ?? "GET",
      body: bodyOf(init),
    });

    const reply = replies[Math.min(index, replies.length - 1)] ?? {
      kind: "content",
      content: "{}",
    };
    index += 1;

    return Promise.resolve(respond(reply));
  };

  return {
    fetch: fetchImpl,
    chatRequests,

    lastMessages() {
      const last = chatRequests.at(-1);
      if (last === undefined) throw new Error("No chat request was made.");

      const messages = last.body["messages"];
      if (!Array.isArray(messages)) throw new Error("The request carried no messages.");

      return {
        system: contentOfRole(messages, "system"),
        user: contentOfRole(messages, "user"),
      };
    },
  };
}

function respond(reply: StubReply): Response {
  switch (reply.kind) {
    case "content":
      return jsonResponse({
        model: "stub",
        message: { role: "assistant", content: reply.content },
        done: true,
      } satisfies Record<string, unknown>);

    case "raw":
      return jsonResponse(reply.payload);

    case "status":
      return new Response(reply.body ?? "", { status: reply.status });

    case "offline":
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();

  return input.url;
}

function bodyOf(init: Parameters<typeof globalThis.fetch>[1]): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") return {};

  try {
    const parsed: unknown = JSON.parse(body);

    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function contentOfRole(messages: readonly unknown[], role: string): string {
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;

    const record = message as Record<string, unknown>;
    if (record["role"] === role && typeof record["content"] === "string") return record["content"];
  }

  throw new Error(`The request carried no ${role} message.`);
}

/** Builds the reply a well-behaved model would send, so tests do not hand-write envelopes. */
export function modelReply(classification: {
  category: string;
  importance: number;
  confidence: number;
  reason: string;
}): StubReply {
  return { kind: "content", content: JSON.stringify(classification) };
}

/** Guards the stub itself: the envelope it produces has to be one the client accepts. */
export function isWellFormedEnvelope(payload: unknown): boolean {
  return OllamaChatResponseSchema.safeParse(payload).success;
}
