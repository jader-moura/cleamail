import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * The whole local database. One file on the user's machine, nothing hosted.
 *
 * JSON columns are stored as text and validated with Zod on the way out: the database is external
 * input like any other, and a hand-edited or half-migrated row must not reach the domain unchecked.
 */

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  address: text("address").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** How far the last successful fetch got, so a run only asks for what it is missing. */
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
});

export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toJson: text("to_json").notNull().default("[]"),
    ccJson: text("cc_json").notNull().default("[]"),
    replyToJson: text("reply_to_json"),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    /** Plain text only. Providers strip HTML before anything reaches here. */
    bodyText: text("body_text").notNull().default(""),
    headersJson: text("headers_json").notNull().default("{}"),
    providerLabelsJson: text("provider_labels_json").notNull().default("[]"),
    isRead: integer("is_read", { mode: "boolean" }).notNull(),
    isStarred: integer("is_starred", { mode: "boolean" }).notNull(),
    isInInbox: integer("is_in_inbox", { mode: "boolean" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("emails_account_received_idx").on(table.accountId, table.receivedAt),
    index("emails_thread_idx").on(table.threadId),
  ],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    /** Groups the decisions one run produced, so undo can reverse a batch. */
    runId: text("run_id").notNull().default(""),
    /**
     * Null when the model returned something invalid.
     *
     * A decision without a classification is still a decision, and these are exactly the rows a
     * user needs to be able to find. A schema that could not hold them would make the audit log
     * complete only about the cases that went well.
     */
    category: text("category"),
    importance: real("importance"),
    confidence: real("confidence"),
    /** The one sentence shown to the user next to the decision. */
    reason: text("reason"),
    source: text("source"),
    ruleId: text("rule_id"),
    model: text("model"),
    /** Why a human should look at this, and cleamail's own words about what went wrong. */
    reviewReason: text("review_reason"),
    reviewDetail: text("review_detail"),
    actionsJson: text("actions_json").notNull().default("[]"),
    policyVersion: text("policy_version").notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
    /** Null while this is still a dry-run preview. */
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    index("decisions_email_idx").on(table.emailId),
    index("decisions_decided_idx").on(table.decidedAt),
    index("decisions_run_idx").on(table.runId),
  ],
);

export const actions = sqliteTable(
  "actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull(),
    type: text("type").notNull(),
    /** The full action, including the before-state undo needs. */
    payloadJson: text("payload_json").notNull(),
    /** `applied`, `skipped`, `failed` or `reversed`: a no-op is a record, not a change. */
    outcome: text("outcome").notNull().default("applied"),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }).notNull(),
    reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
    error: text("error"),
  },
  (table) => [
    index("actions_email_idx").on(table.emailId),
    index("actions_applied_idx").on(table.appliedAt),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    kind: text("kind").notNull(),
    emailId: text("email_id"),
    decisionId: integer("decision_id"),
    /** Safe to show and to log: ids, categories, counts and reasons. Never a body. */
    summary: text("summary").notNull(),
    detailsJson: text("details_json"),
  },
  (table) => [index("audit_log_at_idx").on(table.at)],
);

export const corrections = sqliteTable(
  "corrections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    /** What cleamail said, null when the user labelled an email it had not classified. */
    fromCategory: text("from_category"),
    toCategory: text("to_category").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("corrections_email_idx").on(table.emailId)],
);

export const embeddings = sqliteTable(
  "embeddings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    vector: text("vector", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [unique("embeddings_email_model_unq").on(table.emailId, table.model)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type DecisionRow = typeof decisions.$inferSelect;
export type NewDecisionRow = typeof decisions.$inferInsert;
export type ActionRow = typeof actions.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
export type EmailRow = typeof emails.$inferSelect;
export type NewEmailRow = typeof emails.$inferInsert;
export type AccountRow = typeof accounts.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
