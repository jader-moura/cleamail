#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { CATEGORIES } from "@cleamail/core";
import { DATASET_V1_PATH, SMOKE_TAG, serializeDataset } from "../dataset.js";
import { buildDataset } from "../generate/build.js";

/**
 * Writes the committed dataset.
 *
 * Run this after changing a scenario, then commit the regenerated file with it. A test asserts the
 * two agree, so the dataset can never quietly stop being what the scenarios describe.
 */
const cases = buildDataset();

writeFileSync(DATASET_V1_PATH, serializeDataset(cases), "utf8");

const scenarios = new Set(cases.map((item) => item.scenario)).size;
const smoke = cases.filter((item) => item.tags.includes(SMOKE_TAG)).length;

process.stdout.write(
  `Wrote ${String(cases.length)} cases from ${String(scenarios)} scenarios, ${String(smoke)} in the smoke set.\n`,
);

for (const category of CATEGORIES) {
  const count = cases.filter((item) => item.expect === category).length;

  process.stdout.write(`  ${category.padEnd(14)}${String(count).padStart(4)}\n`);
}

const tagged = new Map<string, number>();

for (const item of cases) {
  for (const tag of item.tags) tagged.set(tag, (tagged.get(tag) ?? 0) + 1);
}

for (const [tag, count] of [...tagged.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  process.stdout.write(`  tag ${tag.padEnd(10)}${String(count).padStart(4)}\n`);
}
