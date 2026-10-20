import type { LogFields, LogLevel, Logger } from "@cleamail/core";

/**
 * Structured lines on stderr, so command output on stdout stays clean and pipeable.
 *
 * The `Logger` port only accepts scalar fields, so an email or a body cannot be logged by accident.
 * Message ids, counts, categories and reasons are fine; that is the whole budget.
 */
export function createConsoleLogger(
  write: (line: string) => void,
  minimum: LogLevel = "info",
  base: LogFields = {},
): Logger {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

  const log = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (order[level] < order[minimum]) return;

    const merged = { ...base, ...fields };
    const rendered = Object.entries(merged)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");

    write(`${level.padEnd(5)} ${message}${rendered === "" ? "" : ` ${rendered}`}`);
  };

  return {
    debug: (message, fields) => {
      log("debug", message, fields);
    },
    info: (message, fields) => {
      log("info", message, fields);
    },
    warn: (message, fields) => {
      log("warn", message, fields);
    },
    error: (message, fields) => {
      log("error", message, fields);
    },
    child: (fields) => createConsoleLogger(write, minimum, { ...base, ...fields }),
  };
}
