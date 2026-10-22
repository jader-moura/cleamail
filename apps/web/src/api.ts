import type {
  ApiApplyResult,
  ApiAuditEntry,
  ApiDecision,
  ApiEmail,
  ApiStatus,
  ApiUndoResult,
} from "@cleamail/server";

/**
 * The client for the local API.
 *
 * The response types come from the server package as types only, so the wire contract has one
 * definition rather than two that drift. Nothing of the server's code is bundled: these imports
 * disappear at compile time.
 *
 * Every call is relative, which keeps the browser on the origin the app was served from. An
 * absolute URL here would be the one way this app could reach something other than the local
 * service, so there are none.
 */

export type { ApiApplyResult, ApiAuditEntry, ApiDecision, ApiEmail, ApiStatus, ApiUndoResult };

/** What the API answers with when something went wrong, which is the same shape every time. */
export type ApiFailure = {
  readonly code: string;
  readonly message: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);

  if (!response.ok) {
    const failure = readFailure(body);

    throw new ApiRequestError(failure.code, failure.message, response.status);
  }

  return body as T;
}

/** The error body, read defensively: a 502 from somewhere else would not have this shape. */
function readFailure(body: unknown): ApiFailure {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;

    if (typeof error === "object" && error !== null) {
      const { code, message } = error as { code?: unknown; message?: unknown };

      return {
        code: typeof code === "string" ? code : "unknown",
        message: typeof message === "string" ? message : "The local service could not answer.",
      };
    }
  }

  return { code: "unknown", message: "The local service could not answer." };
}

export const api = {
  status: () => request<ApiStatus>("/api/status"),

  decisions: (limit = 200) =>
    request<{ decisions: ApiDecision[] }>(`/api/decisions?limit=${String(limit)}`),

  audit: (limit = 50) => request<{ audit: ApiAuditEntry[] }>(`/api/audit?limit=${String(limit)}`),

  emails: (ids: readonly string[]) =>
    ids.length === 0
      ? Promise.resolve({ emails: [] as ApiEmail[] })
      : request<{ emails: ApiEmail[] }>(`/api/emails?ids=${ids.map(encodeURIComponent).join(",")}`),

  apply: (runId: string) =>
    request<ApiApplyResult>("/api/apply", {
      method: "POST",
      body: JSON.stringify({ runId }),
    }),

  undo: (input: { runId?: string; emailId?: string } = {}) =>
    request<ApiUndoResult>("/api/undo", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
