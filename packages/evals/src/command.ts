import {
  PolicySettingsSchema,
  failure,
  ok,
  type EmailClassifier,
  type Result,
} from "@cleamail/core";
import { DEFAULT_CLASSIFIER_MODEL, createOllamaClassifier } from "@cleamail/llm";
import type { EvalCase } from "./case.js";
import { loadDataset, selectCases } from "./dataset.js";
import { DANGEROUS_TARGET, formatEvalReport } from "./report.js";
import { runEval } from "./runner.js";

/** Matches the CLI: 0 worked, 1 something failed, 2 the command line was wrong, 3 the gate failed. */
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  gate: 3,
} as const;

export type EvalArgs = {
  readonly smoke: boolean;
  /** Turns the dangerous miss target into a non-zero exit. */
  readonly gate: boolean;
  readonly help: boolean;
  /** Measure the cautious mode: label everything, move nothing. */
  readonly labelOnly: boolean;
  readonly limit?: number;
  readonly tag?: string;
  readonly model?: string;
  readonly threshold?: number;
};

const USAGE = [
  "Usage: pnpm eval [options]",
  "",
  "  --smoke             only the 20 cases tagged smoke",
  "  --tag <name>        only cases with this tag, e.g. injection",
  "  --limit <n>         stop after n cases",
  "  --model <name>      the Ollama model to classify with",
  "  --threshold <0..1>  confidence below which an email goes to review",
  "  --label-only        label the cleanable categories without archiving them",
  "  --gate              exit non-zero when the dangerous miss rate is over the target",
  "  --help              this text",
  "",
  "Needs Ollama running on localhost with the model pulled. Nothing touches a mailbox.",
];

export function parseEvalArgs(argv: readonly string[]): Result<EvalArgs> {
  let smoke = false;
  let gate = false;
  let labelOnly = false;
  let help = false;
  let limit: number | undefined;
  let tag: string | undefined;
  let model: string | undefined;
  let threshold: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    // Indexing is typed as possibly absent, and the loop bound rules that out, so the fallback
    // only exists to keep the switch over a plain string.
    const flag = argv[index] ?? "";
    const next = argv[index + 1];

    switch (flag) {
      // `pnpm eval -- --smoke` forwards the separator as an argument.
      case "--":
        break;
      case "--smoke":
        smoke = true;
        break;
      case "--gate":
        gate = true;
        break;
      case "--label-only":
        labelOnly = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--tag":
        if (next === undefined) return failure("config_invalid", "--tag needs a name.");
        tag = next;
        index += 1;
        break;
      case "--model":
        if (next === undefined) return failure("config_invalid", "--model needs a model name.");
        model = next;
        index += 1;
        break;
      case "--limit": {
        const parsed = Number(next);
        if (next === undefined || !Number.isInteger(parsed) || parsed <= 0) {
          return failure("config_invalid", "--limit needs a whole number above zero.");
        }
        limit = parsed;
        index += 1;
        break;
      }
      case "--threshold": {
        const parsed = Number(next);
        if (next === undefined || Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
          return failure("config_invalid", "--threshold needs a number between 0 and 1.");
        }
        threshold = parsed;
        index += 1;
        break;
      }
      default:
        return failure("config_invalid", `Unknown option ${flag}.`);
    }
  }

  return ok({
    smoke,
    gate,
    help,
    labelOnly,
    ...(limit === undefined ? {} : { limit }),
    ...(tag === undefined ? {} : { tag }),
    ...(model === undefined ? {} : { model }),
    ...(threshold === undefined ? {} : { threshold }),
  });
}

export type EvalCommandDeps = {
  readonly argv: readonly string[];
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  /** A line that replaces itself, for progress on a run that takes minutes. */
  readonly progress?: (line: string) => void;
  /** Overridden in tests, so the command can be exercised without the committed file. */
  readonly load?: () => Result<readonly EvalCase[]>;
  /** Overridden in tests, so the command can be exercised without a model server. */
  readonly makeClassifier?: (model: string) => Result<EmailClassifier>;
};

/**
 * `pnpm eval`.
 *
 * Composed the same way the CLI composes a run, through injected dependencies, so the command
 * itself is testable without Ollama while the real entry point wires in the real classifier.
 */
export async function evalCommand(deps: EvalCommandDeps): Promise<number> {
  const args = parseEvalArgs(deps.argv);
  if (!args.ok) {
    deps.err(args.error.message);
    for (const line of USAGE) deps.err(line);

    return EXIT.usage;
  }

  if (args.value.help) {
    for (const line of USAGE) deps.out(line);

    return EXIT.ok;
  }

  const loaded = (deps.load ?? (() => loadDataset()))();
  if (!loaded.ok) {
    deps.err(loaded.error.message);

    return EXIT.failure;
  }

  const cases = selectCases(loaded.value, {
    smoke: args.value.smoke,
    ...(args.value.tag === undefined ? {} : { tag: args.value.tag }),
    ...(args.value.limit === undefined ? {} : { limit: args.value.limit }),
  });

  if (cases.length === 0) {
    deps.err("No cases matched, so there is nothing to measure.");

    return EXIT.failure;
  }

  const model = args.value.model ?? deps.env["CLEAMAIL_MODEL"] ?? DEFAULT_CLASSIFIER_MODEL;
  const classifier = (deps.makeClassifier ?? defaultClassifier)(model);
  if (!classifier.ok) {
    deps.err(classifier.error.message);

    return EXIT.failure;
  }

  deps.out(`Classifying ${String(cases.length)} case(s) with ${model}`);
  deps.out("The first one is slow while the model loads.");
  deps.out("");

  const run = await runEval({
    cases,
    classifier: classifier.value,
    now: deps.now(),
    ...(args.value.threshold === undefined ? {} : { confidenceThreshold: args.value.threshold }),
    ...(args.value.labelOnly
      ? { settings: PolicySettingsSchema.parse({ archiveCleaned: false }) }
      : {}),
    onProgress: (done, total) => {
      deps.progress?.(`  ${String(done)}/${String(total)}`);
    },
  });

  deps.progress?.("");

  if (!run.ok) {
    deps.err(run.error.message);

    return EXIT.failure;
  }

  for (const line of formatEvalReport(run.value)) deps.out(line);

  if (args.value.gate && run.value.metrics.dangerousRate > DANGEROUS_TARGET) {
    deps.err("");
    deps.err("The dangerous miss rate is over the target.");

    return EXIT.gate;
  }

  return EXIT.ok;
}

function defaultClassifier(model: string): Result<EmailClassifier> {
  return createOllamaClassifier({ model });
}
