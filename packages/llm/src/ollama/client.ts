import { failure, ok, type ErrorCode, type Result } from "@cleamail/core";
import { resolveOllamaUrl } from "../hosts.js";
import { OllamaChatResponseSchema, OllamaTagsSchema, type OllamaChatRequest } from "./types.js";

/**
 * How long to wait for a generation.
 *
 * Deliberately generous. Loading an 8B model into memory took 58 seconds on the machine this was
 * written on, against about 1 second once warm, and the first email of a run pays that cost. A
 * tight timeout would make every cold run fail on its first message.
 */
export const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

/** Listing models is a liveness check, so it fails fast instead of hanging `init`. */
export const OLLAMA_PROBE_TIMEOUT_MS = 2_000;

/** Keeps the model resident between emails in a run, so only the first one pays the load. */
const KEEP_ALIVE = "10m";

export type OllamaClientOptions = {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
};

/**
 * A thin client over the two Ollama endpoints cleamail uses.
 *
 * There is no `tools` or `functions` field anywhere in this file, and that is the point: the
 * classifier cannot be given tools by configuration or by accident, because the request body has no
 * place to put them.
 */
export class OllamaClient {
  private constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: typeof globalThis.fetch,
    private readonly timeoutMs: number,
  ) {}

  /** Fails when the configured URL is not on this machine, before any request is built. */
  static create(options: OllamaClientOptions = {}): Result<OllamaClient> {
    const resolved = resolveOllamaUrl(options.baseUrl);
    if (!resolved.ok) return resolved;

    return ok(
      new OllamaClient(
        resolved.value,
        options.fetch ?? globalThis.fetch,
        options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS,
      ),
    );
  }

  /** Returns the assistant message content, unparsed. */
  async chat(request: OllamaChatRequest): Promise<Result<string>> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      stream: false,
      keep_alive: KEEP_ALIVE,
    };

    if (request.format !== undefined) body["format"] = request.format;
    if (request.options !== undefined) body["options"] = request.options;

    const response = await this.post("/api/chat", body, this.timeoutMs);
    if (!response.ok) return response;

    const parsed = OllamaChatResponseSchema.safeParse(response.value);
    if (!parsed.success) {
      return failure("invalid_model_output", "Ollama returned a reply cleamail cannot read.");
    }

    return ok(parsed.data.message.content);
  }

  /** The models this Ollama has pulled. Used by `init` and `status`. */
  async listModels(): Promise<Result<readonly string[]>> {
    const response = await this.get("/api/tags", OLLAMA_PROBE_TIMEOUT_MS);
    if (!response.ok) return response;

    const parsed = OllamaTagsSchema.safeParse(response.value);
    if (!parsed.success) {
      return failure("provider_unavailable", "Ollama returned a model list cleamail cannot read.");
    }

    return ok(parsed.data.models.map((model) => model.name));
  }

  private async get(path: string, timeoutMs: number): Promise<Result<unknown>> {
    return this.send(path, { signal: AbortSignal.timeout(timeoutMs) });
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<Result<unknown>> {
    return this.send(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private async send(path: string, init: RequestInit): Promise<Result<unknown>> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      return failure(
        "provider_unavailable",
        `Could not reach Ollama at ${this.baseUrl}. Install it from https://ollama.com and make sure it is running.`,
        cause,
      );
    }

    if (!response.ok) {
      return failure(
        codeForStatus(response.status),
        await messageForStatus(response, this.baseUrl),
      );
    }

    try {
      return ok(await response.json());
    } catch (cause) {
      return failure("invalid_model_output", "Ollama returned a reply that is not JSON.", cause);
    }
  }
}

function codeForStatus(status: number): ErrorCode {
  if (status === 404) return "not_found";
  if (status === 429) return "provider_rate_limited";

  return "provider_unavailable";
}

/**
 * Ollama answers 404 when the model has not been pulled, which is the single most likely failure
 * for a new user. It is worth a message that says what to do about it.
 */
async function messageForStatus(response: Response, baseUrl: string): Promise<string> {
  if (response.status === 404) {
    return "Ollama does not have that model. Pull it first, for example `ollama pull qwen2.5:7b`.";
  }

  const detail = await response.text().catch(() => "");
  const suffix = detail === "" ? "" : ` ${detail.slice(0, 200)}`;

  return `Ollama at ${baseUrl} answered with ${String(response.status)}.${suffix}`;
}
