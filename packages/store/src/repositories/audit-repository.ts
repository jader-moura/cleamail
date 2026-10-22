import {
  AUDIT_KINDS,
  emailId as toEmailId,
  failure,
  ok,
  systemClock,
  type AuditEntry,
  type AuditKind,
  type AuditLog,
  type Clock,
  type Result,
  type StoredAuditEntry,
} from "@cleamail/core";
import { desc } from "drizzle-orm";
import type { Database } from "../client.js";
import { auditLog, type AuditRow } from "../schema.js";

const DEFAULT_LIMIT = 100;

/**
 * What cleamail did, in words a user could read out loud.
 *
 * Ids, counts, categories and reasons only. Nothing here may hold a subject, a sender or a body:
 * this is the one table a user is most likely to copy into a bug report.
 */
export class SqliteAuditLog implements AuditLog {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async append(entry: AuditEntry): Promise<Result<StoredAuditEntry>> {
    try {
      const at = this.clock.now();

      const inserted = this.db
        .insert(auditLog)
        .values({
          at,
          kind: entry.kind,
          emailId: entry.emailId ?? null,
          decisionId: entry.decisionId ?? null,
          summary: entry.summary,
          detailsJson: entry.details === undefined ? null : JSON.stringify(entry.details),
        })
        .returning()
        .get();

      const stored = toEntry(inserted);
      if (stored === undefined) {
        return failure("store_failure", "The audit entry was written but could not be read back.");
      }

      return ok(stored);
    } catch (cause) {
      return failure("store_failure", "Could not write to the audit log.", cause);
    }
  }

  async list(
    options: { readonly limit?: number } = {},
  ): Promise<Result<readonly StoredAuditEntry[]>> {
    try {
      const rows = this.db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.id))
        .limit(options.limit ?? DEFAULT_LIMIT)
        .all();

      const entries: StoredAuditEntry[] = [];

      for (const row of rows) {
        const entry = toEntry(row);
        // A row with an unknown kind came from a newer version or a hand edit. Skipping it keeps
        // the list readable, and it is a log rather than something cleamail acts on.
        if (entry !== undefined) entries.push(entry);
      }

      return ok(entries);
    } catch (cause) {
      return failure("store_failure", "Could not read the audit log.", cause);
    }
  }
}

function toEntry(row: AuditRow): StoredAuditEntry | undefined {
  if (!isAuditKind(row.kind)) return undefined;

  return {
    id: row.id,
    at: row.at,
    kind: row.kind,
    summary: row.summary,
    ...(row.emailId === null ? {} : { emailId: toEmailId(row.emailId) }),
    ...(row.decisionId === null ? {} : { decisionId: row.decisionId }),
    ...(row.detailsJson === null
      ? {}
      : { details: JSON.parse(row.detailsJson) as Record<string, unknown> }),
  };
}

function isAuditKind(value: string): value is AuditKind {
  return (AUDIT_KINDS as readonly string[]).includes(value);
}
