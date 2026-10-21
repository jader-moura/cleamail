import { parseArgs } from "node:util";
import type { CliDeps } from "./deps.js";
import { EXIT } from "./exit.js";
import { HELP } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
import { logoutCommand } from "./commands/logout.js";
import { notYetCommand } from "./commands/not-yet.js";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { VERSION } from "./version.js";

const NOT_YET = ["start", "undo", "eval"];

const MAX_PAGE_SIZE = 500;

/**
 * Parses the command line and dispatches. Argument parsing is `node:util`'s `parseArgs`: the
 * command surface is small enough that a dependency would carry more risk than value.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  // `pnpm --filter @cleamail/cli dev -- status` forwards the separator itself, so drop a leading one
  // rather than reporting "--" as an unknown command.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = args;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    deps.out(HELP);

    return EXIT.ok;
  }

  if (command === "--version" || command === "-v") {
    deps.out(VERSION);

    return EXIT.ok;
  }

  if (NOT_YET.includes(command)) return notYetCommand(deps, command);

  switch (command) {
    case "init":
      return initCommand(deps);

    case "status":
      return statusCommand(deps);

    case "logout":
      return logoutCommand(deps);

    case "run":
      return runWithFlags(deps, rest);

    default:
      deps.err(`Unknown command "${command}". Run \`cleamail --help\`.`);

      return EXIT.usage;
  }
}

function runWithFlags(deps: CliDeps, argv: readonly string[]): Promise<number> {
  let values: { since?: string; max?: string; "no-classify"?: boolean };

  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        since: { type: "string" },
        max: { type: "string" },
        // Accepted and ignored: nothing is applied to the mailbox yet, so every run is a dry run.
        // The flag exists now so the documented command keeps working once SPEC-011 makes it mean
        // something.
        "dry-run": { type: "boolean" },
        // For fetching without waiting on a model.
        "no-classify": { type: "boolean" },
      },
      allowPositionals: false,
    }));
  } catch (cause) {
    deps.err(cause instanceof Error ? cause.message : "Could not read the options.");

    return Promise.resolve(EXIT.usage);
  }

  const max = values.max === undefined ? 100 : Number.parseInt(values.max, 10);
  if (!Number.isInteger(max) || max < 1 || max > MAX_PAGE_SIZE) {
    deps.err(`--max must be a whole number between 1 and ${MAX_PAGE_SIZE}.`);

    return Promise.resolve(EXIT.usage);
  }

  return runCommand(deps, {
    since: values.since ?? "7d",
    max,
    classify: values["no-classify"] !== true,
  });
}
