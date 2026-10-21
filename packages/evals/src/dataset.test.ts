import { describe, expect, it } from "vitest";
import { CATEGORIES, addressDomain } from "@cleamail/core";
import { SMOKE_TAG, loadDataset, parseDataset, selectCases, serializeDataset } from "./dataset.js";
import type { EvalCase } from "./case.js";

const dataset = loadDataset();

function cases(): readonly EvalCase[] {
  if (!dataset.ok) throw new Error(dataset.error.message);

  return dataset.value;
}

/** RFC 2606 and the reserved `.example` TLD. Nothing else may appear in a committed fixture. */
function isReservedDomain(domain: string): boolean {
  return (
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain.endsWith(".example")
  );
}

describe("the committed eval set", () => {
  it("loads", () => {
    expect(dataset.ok).toBe(true);
  });

  it("holds 300 cases, as the roadmap asks", () => {
    expect(cases()).toHaveLength(300);
  });

  it("is built from many scenarios rather than a few templates", () => {
    const scenarios = new Set(cases().map((item) => item.scenario));

    // The count that matters. 300 variations of a dozen templates would measure almost nothing.
    expect(scenarios.size).toBeGreaterThanOrEqual(60);
  });

  it("gives every case a unique id", () => {
    const ids = cases().map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every category with enough cases to compute a rate", () => {
    for (const category of CATEGORIES) {
      const support = cases().filter((item) => item.expect === category).length;

      expect(support, category).toBeGreaterThanOrEqual(15);
    }
  });

  it("keeps the prompt-injection cases CLAUDE.md requires, each with something it must not say", () => {
    const injection = cases().filter((item) => item.tags.includes("injection"));

    expect(injection.length).toBeGreaterThanOrEqual(15);

    for (const item of injection) {
      expect(item.mustNot.length, item.id).toBeGreaterThan(0);
    }
  });

  it("keeps receipts carrying list headers in the set", () => {
    // The shape that caught the bulk rule archiving receipts in SPEC-007.
    const receipts = cases().filter(
      (item) => item.tags.includes("receipt") && item.email.headers["list-id"] !== undefined,
    );

    expect(receipts.length).toBeGreaterThan(0);
  });

  it("never lists the expected category as an alternative, or forbids it", () => {
    for (const item of cases()) {
      expect(item.acceptable, item.id).not.toContain(item.expect);
      expect(item.mustNot, item.id).not.toContain(item.expect);

      for (const category of item.acceptable) {
        expect(item.mustNot, item.id).not.toContain(category);
      }
    }
  });

  it("uses only reserved example domains, so no real address is ever committed", () => {
    for (const item of cases()) {
      for (const address of [item.email.from, ...item.email.to]) {
        const domain = addressDomain(address);

        expect(domain, `${item.id} ${address.address}`).toBeDefined();
        expect(isReservedDomain(domain ?? ""), `${item.id} ${address.address}`).toBe(true);
      }
    }
  });

  it("tags exactly 20 cases for the smoke subset, spread across every category", () => {
    const smoke = selectCases(cases(), { smoke: true });

    expect(smoke).toHaveLength(20);
    expect(new Set(smoke.map((item) => item.expect)).size).toBe(CATEGORIES.length);
    expect(smoke.some((item) => item.tags.includes("injection"))).toBe(true);
  });
});

describe("parseDataset", () => {
  it("round-trips the committed file", () => {
    const reparsed = parseDataset(serializeDataset(cases()));

    expect(reparsed.ok && reparsed.value).toEqual(cases());
  });

  it("ignores blank lines", () => {
    const text = serializeDataset(cases().slice(0, 2));
    const parsed = parseDataset(`\n${text}\n\n`);

    expect(parsed.ok && parsed.value).toHaveLength(2);
  });

  it("names the line that is not JSON", () => {
    const text = `${serializeDataset(cases().slice(0, 1))}not json\n`;
    const parsed = parseDataset(text);

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.message).toContain("Line 2");
  });

  it("names the line that is JSON but not a case", () => {
    const parsed = parseDataset('{"id":"x"}\n');

    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.message).toContain("Line 1");
  });

  it("refuses an empty set rather than reporting on nothing", () => {
    expect(parseDataset("\n\n").ok).toBe(false);
  });
});

describe("selectCases", () => {
  it("keeps file order and applies the limit after the filters", () => {
    const selected = selectCases(cases(), { smoke: true, limit: 3 });

    expect(selected).toHaveLength(3);
    expect(selected.map((item) => item.id)).toEqual(
      cases()
        .filter((item) => item.tags.includes(SMOKE_TAG))
        .slice(0, 3)
        .map((item) => item.id),
    );
  });

  it("narrows by tag", () => {
    const selected = selectCases(cases(), { tag: "injection" });

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((item) => item.tags.includes("injection"))).toBe(true);
  });

  it("returns everything when asked for nothing in particular", () => {
    expect(selectCases(cases())).toHaveLength(300);
  });
});
