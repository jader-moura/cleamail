import { failure, ok, systemClock, type Clock, type Result } from "@cleamail/core";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "../client.js";
import { settings } from "../schema.js";

/**
 * A small typed key/value table for user settings (thresholds, allowlist, the opt-in trash rule).
 *
 * Reads go through the caller's Zod schema, so a settings file written by an older version, or
 * edited by hand, cannot put an out-of-range threshold in front of the policy engine. A value that
 * does not validate is reported as an error and the caller falls back to its default.
 */
export class SqliteSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  async get<TSchema extends z.ZodType>(
    key: string,
    schema: TSchema,
  ): Promise<Result<z.infer<TSchema> | undefined>> {
    try {
      const row = this.db
        .select({ valueJson: settings.valueJson })
        .from(settings)
        .where(eq(settings.key, key))
        .get();

      if (row === undefined) return ok(undefined);

      const parsed = schema.safeParse(JSON.parse(row.valueJson));
      if (!parsed.success) {
        return failure("config_invalid", `Setting "${key}" is not valid; using the default.`);
      }

      return ok(parsed.data);
    } catch (cause) {
      return failure("store_failure", `Could not read setting "${key}".`, cause);
    }
  }

  async set(key: string, value: unknown): Promise<Result<void>> {
    try {
      const valueJson = JSON.stringify(value);
      const updatedAt = this.clock.now();

      this.db
        .insert(settings)
        .values({ key, valueJson, updatedAt })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson, updatedAt } })
        .run();

      return ok(undefined);
    } catch (cause) {
      return failure("store_failure", `Could not write setting "${key}".`, cause);
    }
  }

  async delete(key: string): Promise<Result<void>> {
    try {
      this.db.delete(settings).where(eq(settings.key, key)).run();

      return ok(undefined);
    } catch (cause) {
      return failure("store_failure", `Could not delete setting "${key}".`, cause);
    }
  }
}
