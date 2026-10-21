import { describe, expect, it } from "vitest";
import { loadDataset, serializeDataset } from "../dataset.js";
import { buildDataset, expandScenario } from "./build.js";
import { SCENARIOS } from "./scenarios.js";
import type { Scenario } from "./scenario.js";

const scenario: Scenario = {
  id: "example-scenario",
  expect: "promotion",
  count: 3,
  from: "{company} <offers@{domain}>",
  subject: "{num} percent off",
  body: "A sale from {company}, ending {day}.",
};

describe("the generator and the committed dataset", () => {
  it("agree, byte for byte", () => {
    const dataset = loadDataset();

    expect(dataset.ok).toBe(true);

    // The point of this test. A scenario edited without regenerating, or a dataset edited by hand,
    // means the committed measurement is no longer the one the scenarios describe.
    expect(serializeDataset(buildDataset())).toBe(
      serializeDataset(dataset.ok ? dataset.value : []),
    );
  });

  it("is deterministic across runs on any machine", () => {
    expect(serializeDataset(buildDataset())).toBe(serializeDataset(buildDataset()));
  });

  it("gives every scenario at least one case", () => {
    const built = buildDataset();

    for (const item of SCENARIOS) {
      expect(built.filter((entry) => entry.scenario === item.id).length, item.id).toBe(item.count);
    }
  });
});

describe("expandScenario", () => {
  it("numbers the cases after the scenario", () => {
    expect(expandScenario(scenario).map((item) => item.id)).toEqual([
      "example-scenario-01",
      "example-scenario-02",
      "example-scenario-03",
    ]);
  });

  it("fills the placeholders and leaves none behind", () => {
    for (const item of expandScenario(scenario)) {
      expect(item.email.subject).not.toContain("{");
      expect(item.email.body).not.toContain("{");
      expect(item.email.from.address).not.toContain("{");
    }
  });

  it("varies the substitutions between variants", () => {
    const bodies = expandScenario(scenario).map((item) => item.email.body);

    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it("gives the sender a display name when the template has one", () => {
    const [first] = expandScenario(scenario);

    expect(first?.email.from.name).toBeDefined();
  });

  it("omits the display name when the template is a bare address", () => {
    const [first] = expandScenario({ ...scenario, from: "offers@{domain}", count: 1 });

    expect(first?.email.from.name).toBeUndefined();
  });

  it("puts only the first variant in the smoke set", () => {
    const expanded = expandScenario({ ...scenario, smoke: true });

    expect(expanded.map((item) => item.tags)).toEqual([["smoke"], [], []]);
  });

  it("addresses the mailbox directly by default and a list when asked", () => {
    const [direct] = expandScenario({ ...scenario, count: 1 });
    const [list] = expandScenario({ ...scenario, count: 1, to: "list" });
    const [many] = expandScenario({ ...scenario, count: 1, to: "many" });
    const [none] = expandScenario({ ...scenario, count: 1, to: "undisclosed" });

    expect(direct?.email.to).toEqual([{ address: "you@example.com" }]);
    expect(list?.email.to[0]?.address).toMatch(/^members@/);
    // Five is what the rules layer calls many, so this is the shape that earns the hint.
    expect(many?.email.to).toHaveLength(5);
    expect(none?.email.to).toEqual([]);
  });

  it("throws on a placeholder no pool fills, rather than committing it", () => {
    expect(() => expandScenario({ ...scenario, subject: "Hello {nosuchpool}" })).toThrow(
      "{nosuchpool}",
    );
  });

  it("lowercases header names, the way the providers normalize them", () => {
    const [first] = expandScenario({
      ...scenario,
      count: 1,
      headers: { "List-Id": "news.{domain}" },
    });

    expect(Object.keys(first?.email.headers ?? {})).toEqual(["list-id"]);
  });
});
