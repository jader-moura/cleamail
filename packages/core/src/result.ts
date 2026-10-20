/**
 * Typed results for domain and port code.
 *
 * Domain code returns results instead of throwing, so every caller has exactly one error path and
 * no failure can silently skip a safety check. Adapters throw only at their outermost boundary and
 * convert to a {@link DomainError} on the way out.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export const ERROR_CODES = [
  "provider_auth",
  "provider_unavailable",
  "provider_rate_limited",
  "not_found",
  "invalid_model_output",
  "invalid_provider_data",
  "store_failure",
  "config_invalid",
  "unsupported_operation",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type DomainError = {
  readonly code: ErrorCode;
  /** Safe to show the user and to log. Never put email content in here. */
  readonly message: string;
  readonly cause?: unknown;
};

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function domainError(code: ErrorCode, message: string, cause?: unknown): DomainError {
  return cause === undefined ? { code, message } : { code, message, cause };
}

export function failure(code: ErrorCode, message: string, cause?: unknown): Err<DomainError> {
  return err(domainError(code, message, cause));
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
