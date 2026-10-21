import { readFileSync } from "node:fs";
import { failure, ok, type Result } from "@cleamail/core";
import { EvalCaseSchema, serializeCase, type EvalCase } from "./case.js";

/**
 * The committed eval set.
 *
 * Resolved from this module rather than the working directory, so `pnpm eval` behaves the same from
 * the repository root, from the package, and from a dist build: `src` and `dist` both sit one level
 * under the package root.
 */
export const DATASET_V1_PATH = new URL("../datasets/v1.jsonl", import.meta.url);

export const SMOKE_TAG = "smoke";

/**
 * Parses the JSONL form.
 *
 * Validated line by line through Zod, and a bad line names its own number. The dataset is the input
 * to a measurement, so a case that is quietly dropped or half-parsed would move the score without
 * leaving a trace.
 */
export function parseDataset(text: string): Result<readonly EvalCase[]> {
  const cases: EvalCase[] = [];
  const lines = text.split("\n");

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const lineNumber = index + 1;
    let json: unknown;

    try {
      json = JSON.parse(trimmed);
    } catch {
      return failure("config_invalid", `Line ${String(lineNumber)} of the eval set is not JSON.`);
    }

    const parsed = EvalCaseSchema.safeParse(json);
    if (!parsed.success) {
      return failure(
        "config_invalid",
        `Line ${String(lineNumber)} of the eval set is not a valid case: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    cases.push(parsed.data);
  }

  if (cases.length === 0) return failure("config_invalid", "The eval set is empty.");

  return ok(cases);
}

export function loadDataset(path: URL = DATASET_V1_PATH): Result<readonly EvalCase[]> {
  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return failure("not_found", `Could not read the eval set at ${path.pathname}.`, cause);
  }

  return parseDataset(text);
}

/** One case per line, with a trailing newline, which is what a text file is. */
export function serializeDataset(cases: readonly EvalCase[]): string {
  return cases.map((evalCase) => `${serializeCase(evalCase)}\n`).join("");
}

export type SelectOptions = {
  /** Only the cases tagged `smoke`: the 20-case subset. */
  readonly smoke?: boolean;
  readonly tag?: string;
  readonly limit?: number;
};

/**
 * Narrows the set, preserving file order.
 *
 * Order is kept rather than sampled: a 20-case subset exists so its contents are predictable, and a
 * sampler would silently change which cases ran every time the set grew.
 */
export function selectCases(
  cases: readonly EvalCase[],
  options: SelectOptions = {},
): readonly EvalCase[] {
  let selected = cases;

  if (options.smoke === true) {
    selected = selected.filter((evalCase) => evalCase.tags.includes(SMOKE_TAG));
  }

  const { tag } = options;
  if (tag !== undefined) {
    selected = selected.filter((evalCase) => evalCase.tags.includes(tag));
  }

  const { limit } = options;
  if (limit !== undefined && limit >= 0 && limit < selected.length) {
    selected = selected.slice(0, limit);
  }

  return selected;
}
