import { GMAIL_API_BASE } from "../hosts.js";
import type { AccessTokenProvider } from "./access-token.js";
import { isRetryable } from "./errors.js";
import type { FetchLike } from "./oauth.js";
import {
  GmailLabelSchema,
  GmailListResponseSchema,
  GmailMessageSchema,
  GmailProfileSchema,
  type GmailApi,
  type GmailLabel,
  type GmailListResponse,
  type GmailMessage,
  type GmailProfile,
  type LabelChanges,
  type ListMessagesParams,
} from "./types.js";
import { z } from "zod";

/** Carries the HTTP status so the provider can tell "reconnect" from "try again later". */
export class GmailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GmailHttpError";
  }
}

const LabelsResponseSchema = z.object({
  labels: z.array(GmailLabelSchema.partial({ name: true })).default([]),
});

export type GmailRestOptions = {
  readonly fetchImpl?: FetchLike;
  readonly maxRetries?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Gmail REST API behind the narrow {@link GmailApi} port.
 *
 * It is a hand-rolled client over six endpoints rather than the full `googleapis` package: the
 * install stays small enough for `npx cleamail`, every request is visible in this file, and the
 * privacy guard in SPEC-006 can assert on one list of hosts. Responses are validated with Zod
 * before they reach the mapper.
 */
export class GmailRestApi implements GmailApi {
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly tokens: AccessTokenProvider,
    options: GmailRestOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = options.sleep ?? wait;
  }

  async getProfile(): Promise<GmailProfile> {
    return this.request("/profile", { method: "GET" }, GmailProfileSchema);
  }

  async listMessages(params: ListMessagesParams): Promise<GmailListResponse> {
    const query = new URLSearchParams({ q: params.query });
    if (params.maxResults !== undefined) query.set("maxResults", `${params.maxResults}`);
    if (params.pageToken !== undefined) query.set("pageToken", params.pageToken);

    return this.request(
      `/messages?${query.toString()}`,
      { method: "GET" },
      GmailListResponseSchema,
    );
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return this.request(
      `/messages/${encodeURIComponent(id)}?format=full`,
      { method: "GET" },
      GmailMessageSchema,
    );
  }

  async modifyMessage(id: string, changes: LabelChanges): Promise<void> {
    await this.request(
      `/messages/${encodeURIComponent(id)}/modify`,
      {
        method: "POST",
        body: JSON.stringify({
          addLabelIds: changes.addLabelIds ?? [],
          removeLabelIds: changes.removeLabelIds ?? [],
        }),
      },
      z.unknown(),
    );
  }

  async trashMessage(id: string): Promise<void> {
    await this.request(
      `/messages/${encodeURIComponent(id)}/trash`,
      { method: "POST" },
      z.unknown(),
    );
  }

  async untrashMessage(id: string): Promise<void> {
    await this.request(
      `/messages/${encodeURIComponent(id)}/untrash`,
      { method: "POST" },
      z.unknown(),
    );
  }

  async listLabels(): Promise<GmailLabel[]> {
    const response = await this.request("/labels", { method: "GET" }, LabelsResponseSchema);

    return response.labels
      .filter((label): label is GmailLabel => label.name !== undefined)
      .map((label) => ({ id: label.id, name: label.name }));
  }

  async createLabel(name: string): Promise<GmailLabel> {
    return this.request(
      "/labels",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      },
      GmailLabelSchema,
    );
  }

  private async request<TSchema extends z.ZodType>(
    path: string,
    init: { method: string; body?: string },
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const token = await this.tokens.token();
    if (!token.ok) throw new GmailHttpError(token.error.message, 401);

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        // Exponential backoff. Gmail's per-user quota recovers in seconds, not minutes.
        await this.sleep(2 ** attempt * 250);
      }

      try {
        const response = await this.fetchImpl(`${GMAIL_API_BASE}${path}`, {
          method: init.method,
          headers: {
            authorization: `Bearer ${token.value}`,
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(init.body === undefined ? {} : { body: init.body }),
        });

        if (!response.ok) {
          const error = new GmailHttpError(
            `Gmail returned ${response.status} for ${init.method} ${path}.`,
            response.status,
          );

          if (!isRetryable(error) || attempt === this.maxRetries) throw error;
          lastError = error;
          continue;
        }

        const parsed = schema.safeParse(await response.json().catch(() => ({})));
        if (!parsed.success) {
          // 422, not a 5xx: a response cleamail cannot read will not read better on a retry.
          throw new GmailHttpError(`Gmail returned an unexpected shape for ${path}.`, 422);
        }

        return parsed.data;
      } catch (cause) {
        if (cause instanceof GmailHttpError && !isRetryable(cause)) throw cause;
        if (attempt === this.maxRetries) throw cause;
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new GmailHttpError(`Gmail request to ${path} failed.`, 503);
  }
}
