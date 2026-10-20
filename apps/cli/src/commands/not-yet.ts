import type { CliDeps } from "../deps.js";
import { EXIT } from "../exit.js";

/** Commands the roadmap has not reached yet. They say so plainly instead of doing something odd. */
const PHASES: Record<string, string> = {
  start: "the background service lands in phase 3 (SPEC-015)",
  undo: "undo lands in phase 3 (SPEC-012)",
  eval: "the eval runner lands in phase 2 (SPEC-010)",
};

export function notYetCommand(deps: CliDeps, command: string): number {
  deps.err(`\`cleamail ${command}\` is not available yet: ${PHASES[command] ?? "coming later"}.`);
  deps.err("Run `cleamail --help` to see what works today.");

  return EXIT.failure;
}
