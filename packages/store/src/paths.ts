import { homedir } from "node:os";
import { join } from "node:path";

export const DATABASE_FILE_NAME = "cleamail.sqlite";

/** In-memory marker understood by {@link openStore}, used by tests. */
export const IN_MEMORY = ":memory:";

export type PathEnvironment = {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
};

function currentEnvironment(): PathEnvironment {
  return { platform: process.platform, env: process.env, home: homedir() };
}

/**
 * Where the one local database file lives.
 *
 * `CLEAMAIL_DB` overrides everything, which is what the eval runner and the tests use. Otherwise it
 * is the per-user application data directory for the platform: nothing is written next to the
 * installed package, and nothing leaves the machine.
 */
export function resolveDataDirectory(environment: PathEnvironment = currentEnvironment()): string {
  const { platform, env, home } = environment;

  if (platform === "win32") {
    const base = env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    return join(base, "cleamail");
  }

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "cleamail");
  }

  const base = env["XDG_DATA_HOME"] ?? join(home, ".local", "share");
  return join(base, "cleamail");
}

export function resolveDatabasePath(environment: PathEnvironment = currentEnvironment()): string {
  const override = environment.env["CLEAMAIL_DB"];
  if (override !== undefined && override !== "") return override;

  return join(resolveDataDirectory(environment), DATABASE_FILE_NAME);
}
