import { z } from "zod";
import { failure, ok, type Result } from "@cleamail/core";

/**
 * The only address this server ever binds.
 *
 * Not a setting. A local-first product that could be talked into listening on a laptop's wifi
 * address would have broken its own promise, so the host is a constant and the test asserts it.
 */
export const HOST = "127.0.0.1";

export const DEFAULT_PORT = 4571;

/** The hostnames a browser may use to reach the server. Anything else is someone else's page. */
export const ALLOWED_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];

export type ServerConfig = {
  readonly host: typeof HOST;
  readonly port: number;
};

const PortSchema = z.coerce.number().int().min(1024).max(65_535);

/**
 * Reads the port from the environment.
 *
 * Ports below 1024 need privileges nobody should be granting a mail tool, so they are refused here
 * rather than failing with a permission error at `listen`.
 */
export function readConfig(
  env: Readonly<Record<string, string | undefined>> = {},
): Result<ServerConfig> {
  const raw = env["CLEAMAIL_PORT"];
  if (raw === undefined || raw.trim() === "") return ok({ host: HOST, port: DEFAULT_PORT });

  const parsed = PortSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(
      "config_invalid",
      `CLEAMAIL_PORT must be a whole number between 1024 and 65535, not "${raw}".`,
    );
  }

  return ok({ host: HOST, port: parsed.data });
}
