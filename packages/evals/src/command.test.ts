import { describe, expect, it } from "vitest";
import { failure, ok, type EmailClassifier, type Result } from "@cleamail/core";
import { EvalCaseSchema, type EvalCase } from "./case.js";
import { EXIT, evalCommand, parseEvalArgs } from "./command.js";
import { ScriptedClassifier } from "./test/classifier.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function evalCase(id: string, overrides: Partial<EvalCase> = {}): EvalCase {
  return EvalCaseSchema.parse({
    id,
    scenario: `scenario-${id}`,
    expect: "important",
    email: {
      from: { address: "someone@example.org" },
      to: [{ address: "you@example.com" }],
      subject: "Hello",
      body: "A message.",
    },
    ...overrides,
  });
}

type Harness = {
  readonly out: string[];
  readonly err: string[];
  readonly models: string[];
  run: (argv: readonly string[]) => Promise<number>;
};

function harness(options: {
  readonly cases?: readonly EvalCase[];
  readonly classifier?: EmailClassifier;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly load?: () => Result<readonly EvalCase[]>;
  readonly makeClassifier?: (model: string) => Result<EmailClassifier>;
}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const models: string[] = [];

  const classifier = options.classifier ?? new ScriptedClassifier({}, "important");

  return {
    out,
    err,
    models,
    run: (argv) =>
      evalCommand({
        argv,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        env: options.env ?? {},
        now: () => NOW,
        load: options.load ?? (() => ok(options.cases ?? [evalCase("a")])),
        makeClassifier:
          options.makeClassifier ??
          ((model) => {
            models.push(model);

            return ok(classifier);
          }),
      }),
  };
}

describe("parseEvalArgs", () => {
  it("defaults to the whole set with no gate", () => {
    expect(parseEvalArgs([])).toEqual(
      ok({ smoke: false, gate: false, help: false, labelOnly: false }),
    );
  });

  it("reads the flags", () => {
    const parsed = parseEvalArgs([
      "--smoke",
      "--gate",
      "--tag",
      "injection",
      "--limit",
      "5",
      "--model",
      "llama3.2:3b",
      "--threshold",
      "0.8",
    ]);

    expect(parsed.ok && parsed.value).toEqual({
      smoke: true,
      gate: true,
      help: false,
      labelOnly: false,
      tag: "injection",
      limit: 5,
      model: "llama3.2:3b",
      threshold: 0.8,
    });
  });

  it("refuses a limit that is not a whole number above zero", () => {
    for (const value of ["0", "-2", "2.5", "many"]) {
      expect(parseEvalArgs(["--limit", value]).ok, value).toBe(false);
    }
  });

  it("refuses a threshold outside 0 to 1", () => {
    for (const value of ["-0.1", "1.5", "high"]) {
      expect(parseEvalArgs(["--threshold", value]).ok, value).toBe(false);
    }
  });

  it("refuses a flag with nothing after it", () => {
    expect(parseEvalArgs(["--model"]).ok).toBe(false);
    expect(parseEvalArgs(["--tag"]).ok).toBe(false);
  });

  it("tolerates the separator pnpm forwards for `pnpm eval -- --smoke`", () => {
    const parsed = parseEvalArgs(["--", "--smoke"]);

    expect(parsed.ok && parsed.value.smoke).toBe(true);
  });

  it("refuses an unknown flag instead of ignoring it", () => {
    const parsed = parseEvalArgs(["--everything"]);

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.message).toContain("--everything");
  });
});

describe("evalCommand", () => {
  it("prints the usage and stops when the command line is wrong", async () => {
    const cli = harness({});

    expect(await cli.run(["--nope"])).toBe(EXIT.usage);
    expect(cli.err.join("\n")).toContain("Usage: pnpm eval");
    expect(cli.out).toEqual([]);
  });

  it("prints the usage to stdout for --help", async () => {
    const cli = harness({});

    expect(await cli.run(["--help"])).toBe(EXIT.ok);
    expect(cli.out.join("\n")).toContain("Usage: pnpm eval");
  });

  it("prints the report and exits zero", async () => {
    const cli = harness({ cases: [evalCase("a"), evalCase("b")] });

    expect(await cli.run([])).toBe(EXIT.ok);

    const text = cli.out.join("\n");

    expect(text).toContain("Classifying 2 case(s)");
    expect(text).toContain("cleamail eval");
    expect(text).toContain("Safety");
  });

  it("takes the model from the flag, then the environment, then the documented default", async () => {
    const flagged = harness({ env: { CLEAMAIL_MODEL: "from-env" } });
    await flagged.run(["--model", "from-flag"]);

    const fromEnv = harness({ env: { CLEAMAIL_MODEL: "from-env" } });
    await fromEnv.run([]);

    const fallback = harness({});
    await fallback.run([]);

    expect(flagged.models).toEqual(["from-flag"]);
    expect(fromEnv.models).toEqual(["from-env"]);
    expect(fallback.models).toEqual(["qwen2.5:7b"]);
  });

  it("applies the selection flags", async () => {
    const cli = harness({
      cases: [evalCase("a", { tags: ["injection"] }), evalCase("b"), evalCase("c")],
    });

    expect(await cli.run(["--tag", "injection"])).toBe(EXIT.ok);
    expect(cli.out.join("\n")).toContain("Classifying 1 case(s)");
  });

  it("stops when nothing matched, rather than reporting on an empty run", async () => {
    const cli = harness({ cases: [evalCase("a")] });

    expect(await cli.run(["--tag", "nothing-has-this"])).toBe(EXIT.failure);
    expect(cli.err.join("\n")).toContain("nothing to measure");
  });

  it("reports why the dataset could not be loaded", async () => {
    const cli = harness({ load: () => failure("not_found", "Could not read the eval set.") });

    expect(await cli.run([])).toBe(EXIT.failure);
    expect(cli.err.join("\n")).toContain("Could not read the eval set.");
  });

  it("reports why the classifier could not be built", async () => {
    const cli = harness({
      makeClassifier: () => failure("config_invalid", "Ollama must be on localhost."),
    });

    expect(await cli.run([])).toBe(EXIT.failure);
    expect(cli.err.join("\n")).toContain("Ollama must be on localhost.");
  });

  it("reports a run that could not finish", async () => {
    const cli = harness({
      classifier: new ScriptedClassifier({ a: { fail: "provider_unavailable" } }),
    });

    expect(await cli.run([])).toBe(EXIT.failure);
    expect(cli.err.join("\n")).toContain("case a");
  });

  it("exits zero over the target unless the gate was asked for", async () => {
    const cases = [evalCase("a"), evalCase("b")];
    const classifier = new ScriptedClassifier({}, "promotion");

    const ungated = harness({ cases, classifier });
    const gated = harness({ cases, classifier });

    expect(await ungated.run([])).toBe(EXIT.ok);
    expect(await gated.run(["--gate"])).toBe(EXIT.gate);
    expect(gated.err.join("\n")).toContain("over the target");
  });

  it("measures the cautious mode, where nothing is ever removed from an inbox", async () => {
    const cases = [evalCase("a"), evalCase("b")];
    const classifier = new ScriptedClassifier({}, "promotion");

    const archiving = harness({ cases, classifier });
    const labelOnly = harness({ cases, classifier });

    expect(await archiving.run(["--gate"])).toBe(EXIT.gate);
    expect(await labelOnly.run(["--gate", "--label-only"])).toBe(EXIT.ok);
    expect(labelOnly.out.join(" ")).toContain("nothing is ever removed");
  });

  it("passes the gate when nothing dangerous happened", async () => {
    const cli = harness({ cases: [evalCase("a")] });

    expect(await cli.run(["--gate"])).toBe(EXIT.ok);
  });
});
