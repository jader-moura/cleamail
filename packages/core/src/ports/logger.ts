/**
 * Structured logging with a deliberately narrow field type.
 *
 * Fields are scalars only, so an email, a body or a token cannot be dropped into a log line by
 * passing an object. Message ids, categories, reasons and counts are fine; bodies never are.
 */
export type LogField = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogField>>;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/** For tests and for code paths where logging is optional. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
