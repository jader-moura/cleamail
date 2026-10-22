import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  toApiAuditEntry,
  toApiDecision,
  toApiEmail,
  type ApiApplyResult,
  type ApiAuditEntry,
  type ApiDecision,
  type ApiEmail,
  type ApiStatus,
  type ApiUndoResult,
} from "./api.js";
import type { ServerDeps } from "./deps.js";
import { applyDecisions, emailId, explainDecision, undoRun, type DomainError } from "./ports.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  runId: z.string().min(1).optional(),
  emailId: z.string().min(1).optional(),
});

const EmailQuerySchema = z.object({
  /** Comma-separated ids, which is what a list of rows already has in hand. */
  ids: z.string().min(1),
});

const MAX_IDS = 200;

const ApplyBodySchema = z.object({
  /** The run the user is approving, which is a run they were shown. */
  runId: z.string().min(1),
});

const UndoBodySchema = z
  .object({
    runId: z.string().min(1).optional(),
    emailId: z.string().min(1).optional(),
  })
  .default({});

/**
 * How a domain error becomes a status code.
 *
 * The code travels in the body as well, so the dashboard can tell "nothing to undo" from "this
 * mailbox is read-only" without reading the prose.
 */
const STATUS_FOR: Readonly<Record<DomainError["code"], number>> = {
  provider_auth: 401,
  provider_unavailable: 502,
  provider_rate_limited: 429,
  not_found: 404,
  invalid_model_output: 502,
  invalid_provider_data: 502,
  store_failure: 500,
  config_invalid: 409,
  unsupported_operation: 409,
};

export function registerRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get("/api/health", () => ({ status: "ok", version: deps.version }));

  app.get("/api/status", async (_request, reply) => {
    const status = await readStatus(deps);

    return reply.send(status);
  });

  app.get("/api/decisions", async (request, reply) => {
    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);

    const account = await deps.account();
    if (!account.ok) return fail(reply, account.error);

    const stored = await deps.store.decisions.listDecisions({
      accountId: account.value.id,
      limit: query.data.limit,
      ...(query.data.runId === undefined ? {} : { runId: query.data.runId }),
      ...(query.data.emailId === undefined ? {} : { emailId: emailId(query.data.emailId) }),
    });
    if (!stored.ok) return fail(reply, stored.error);

    const decisions: ApiDecision[] = stored.value.map((row) =>
      toApiDecision(row, explainDecision(row.decision)),
    );

    return reply.send({ decisions });
  });

  app.get("/api/audit", async (request, reply) => {
    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);

    const entries = await deps.store.audit.list({ limit: query.data.limit });
    if (!entries.ok) return fail(reply, entries.error);

    const audit: ApiAuditEntry[] = entries.value.map((entry) => toApiAuditEntry(entry));

    return reply.send({ audit });
  });

  app.get("/api/emails", async (request, reply) => {
    const query = EmailQuerySchema.safeParse(request.query);
    if (!query.success) return badRequest(reply, query.error);

    const ids = query.data.ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");

    if (ids.length === 0 || ids.length > MAX_IDS) {
      return reply.code(400).send({
        error: {
          code: "bad_request",
          message: `ids: between 1 and ${String(MAX_IDS)} message ids, separated by commas`,
        },
      });
    }

    const emails: ApiEmail[] = [];

    for (const id of ids) {
      const found = await deps.store.emails.getEmail(emailId(id));
      if (!found.ok) return fail(reply, found.error);

      // A missing id is left out rather than refused: a decision can outlive the mail it was about
      // if the user deleted the message themselves, and the list should still render.
      if (found.value !== undefined) emails.push(toApiEmail(found.value));
    }

    return reply.send({ emails });
  });

  app.post("/api/apply", async (request, reply) => {
    const body = ApplyBodySchema.safeParse(request.body ?? {});
    if (!body.success) return badRequest(reply, body.error);

    // This one changes a mailbox, so it needs a provider and not just an account id.
    const connected = await deps.connect();
    if (!connected.ok) return fail(reply, connected.error);

    const stored = await deps.store.decisions.listDecisions({
      accountId: connected.value.account.id,
      runId: body.data.runId,
    });
    if (!stored.ok) return fail(reply, stored.error);

    if (stored.value.length === 0) {
      return fail(reply, {
        code: "not_found",
        message: `There is no run ${body.data.runId} to apply.`,
      });
    }

    const previews = stored.value.filter((row) => row.dryRun);
    if (previews.length === 0) {
      // Applying twice would plan from before-states that are no longer true, and undo already
      // exists for changing your mind. So this is refused rather than quietly doing nothing.
      return fail(reply, {
        code: "unsupported_operation",
        message: `Run ${body.data.runId} was already applied. Use undo if you want it back.`,
      });
    }

    const now = deps.clock.now();

    // The decisions the user was shown, handed to the one code path that changes a mailbox. The
    // server plans nothing: these were planned by the policy engine when the preview was recorded.
    const applied = await applyDecisions(
      {
        accountId: connected.value.account.id,
        decisions: previews.map((row) => row.decision),
      },
      {
        provider: connected.value.provider,
        decisions: deps.store.decisions,
        audit: deps.store.audit,
        runId: `apply-${now.toISOString()}`,
        now,
      },
    );

    if (!applied.ok) return fail(reply, applied.error);

    const result: ApiApplyResult = {
      runId: applied.value.runId,
      emailsChanged: applied.value.emailsChanged,
      applied: applied.value.applied,
      skipped: applied.value.skipped,
      failures: applied.value.failures,
    };

    return reply.send(result);
  });

  app.post("/api/undo", async (request, reply) => {
    const body = UndoBodySchema.safeParse(request.body ?? {});
    if (!body.success) return badRequest(reply, body.error);

    const connected = await deps.connect();
    if (!connected.ok) return fail(reply, connected.error);

    const now = deps.clock.now();

    // The same executor the CLI calls. There is one code path that changes a mailbox, and this is
    // not a second one.
    const result = await undoRun(
      {
        accountId: connected.value.account.id,
        ...(body.data.runId === undefined ? {} : { runId: body.data.runId }),
        ...(body.data.emailId === undefined ? {} : { emailId: emailId(body.data.emailId) }),
      },
      {
        provider: connected.value.provider,
        decisions: deps.store.decisions,
        audit: deps.store.audit,
        runId: `undo-${now.toISOString()}`,
        now,
      },
    );

    if (!result.ok) return fail(reply, result.error);

    const undone: ApiUndoResult = {
      runId: result.value.runId,
      emailsRestored: result.value.emailsRestored,
      reversed: result.value.reversed,
      alreadyReversed: result.value.alreadyReversed,
      failures: result.value.failures,
    };

    return reply.send(undone);
  });
}

async function readStatus(deps: ServerDeps): Promise<ApiStatus> {
  const base = {
    version: deps.version,
    database: deps.store.path,
    model: deps.classifierModel,
  };

  const account = await deps.account();
  if (!account.ok) return base;

  const [messages, lastSync] = await Promise.all([
    deps.store.emails.countEmails(account.value.id),
    deps.store.emails.lastSyncAt(account.value.id),
  ]);

  // Asked of the provider, and left out when there is no provider to ask. Saying "read-only" when
  // the truth is "cleamail could not tell" would send a user to re-run `init` for the wrong reason.
  const connected = await deps.connect();
  const capabilities = connected.ok ? await connected.value.provider.capabilities() : undefined;

  return {
    ...base,
    mailbox: {
      address: account.value.address,
      kind: account.value.kind,
      messages: messages.ok ? messages.value : 0,
      ...(capabilities?.ok === true ? { canModify: capabilities.value.canModify } : {}),
      ...(lastSync.ok && lastSync.value !== undefined
        ? { lastSyncAt: lastSync.value.toISOString() }
        : {}),
    },
  };
}

/** A bad query string or body names the field, rather than becoming a 500. */
function badRequest(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const first = error.issues[0];
  const where = first === undefined ? "the request" : first.path.join(".") || "the request";
  const why = first === undefined ? "could not be read" : first.message;

  return reply.code(400).send({
    error: { code: "bad_request", message: `${where}: ${why}` },
  });
}

function fail(reply: FastifyReply, error: DomainError): FastifyReply {
  return reply.code(STATUS_FOR[error.code]).send({
    error: { code: error.code, message: error.message },
  });
}
