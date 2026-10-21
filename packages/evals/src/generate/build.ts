import type { EmailAddress } from "@cleamail/core";
import { EvalCaseSchema, type EvalCase } from "../case.js";
import { EVAL_ACCOUNT_ADDRESS } from "../to-email.js";
import { SMOKE_TAG } from "../dataset.js";
import {
  AMOUNTS,
  CITIES,
  COMPANIES,
  DAYS,
  NUMBERS,
  ORDERS,
  PEOPLE,
  PROJECTS,
  TIMES,
} from "./pools.js";
import type { Recipients, Scenario } from "./scenario.js";
import { SCENARIOS } from "./scenarios.js";

const PLACEHOLDER = /\{([a-z]+)\}/g;

const ADDRESS_WITH_NAME = /^(.*?)\s*<([^<>]+)>$/;

const MANY_RECIPIENTS = 5;

/**
 * Builds the whole set.
 *
 * Every case is parsed by its own schema on the way out, so a scenario with a typo in a category or
 * a placeholder that no pool fills fails here, at generation time, rather than becoming a quietly
 * malformed line in a committed dataset.
 */
export function buildDataset(scenarios: readonly Scenario[] = SCENARIOS): readonly EvalCase[] {
  return scenarios.flatMap((scenario) => expandScenario(scenario));
}

export function expandScenario(scenario: Scenario): readonly EvalCase[] {
  const cases: EvalCase[] = [];

  for (let variant = 0; variant < scenario.count; variant += 1) {
    const values = substitutions(scenario.id, variant);
    const tags = [...(scenario.tags ?? [])];

    if (scenario.smoke === true && variant === 0) tags.push(SMOKE_TAG);

    cases.push(
      EvalCaseSchema.parse({
        id: `${scenario.id}-${String(variant + 1).padStart(2, "0")}`,
        scenario: scenario.id,
        expect: scenario.expect,
        acceptable: scenario.acceptable ?? [],
        mustNot: scenario.mustNot ?? [],
        tags,
        email: {
          from: parseAddress(fill(scenario.from, values)),
          to: recipients(scenario.to ?? "me", values),
          subject: fill(scenario.subject, values),
          body: fill(scenario.body, values),
          headers: fillHeaders(scenario.headers ?? {}, values),
          providerLabels: scenario.labels ?? ["INBOX"],
          ageHours: scenario.ageHours ?? 6 + variant * 7,
        },
      }),
    );
  }

  return cases;
}

/**
 * Picks the pool entries for one variant.
 *
 * The scenario id seeds it, so two scenarios do not both open with the same person, and the strides
 * differ per pool so consecutive variants change in several fields at once rather than marching
 * through the pools in lockstep.
 */
function substitutions(scenarioId: string, variant: number): Readonly<Record<string, string>> {
  const seed = hash(scenarioId);
  const person = pick(PEOPLE, seed + variant);
  const other = pick(PEOPLE, seed + variant + 5);
  const company = pick(COMPANIES, seed + variant * 3);

  return {
    person: person.name,
    first: person.first,
    sender: person.slug,
    other: other.name,
    company: company.name,
    domain: company.domain,
    amount: pick(AMOUNTS, seed + variant * 3),
    order: pick(ORDERS, seed + variant * 5),
    city: pick(CITIES, seed + variant * 2),
    project: pick(PROJECTS, seed + variant * 4),
    day: pick(DAYS, seed + variant * 2),
    time: pick(TIMES, seed + variant * 3),
    num: pick(NUMBERS, seed + variant * 2),
  };
}

/** Throws on a placeholder no pool fills, which is how a scenario typo surfaces immediately. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`No pool fills ${match}.`);

    return value;
  });
}

function fillHeaders(
  headers: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const filled: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    filled[name.toLowerCase()] = fill(value, values);
  }

  return filled;
}

function parseAddress(value: string): EmailAddress {
  const withName = ADDRESS_WITH_NAME.exec(value);
  if (withName === null) return { address: value.trim() };

  const name = (withName[1] ?? "").trim();
  const address = (withName[2] ?? "").trim();

  return name === "" ? { address } : { address, name };
}

function recipients(mode: Recipients, values: Readonly<Record<string, string>>): EmailAddress[] {
  const me: EmailAddress = { address: EVAL_ACCOUNT_ADDRESS };

  switch (mode) {
    case "me":
      return [me];
    case "list":
      return [{ address: `members@${values["domain"] ?? "example.com"}` }];
    case "many":
      return [
        me,
        ...Array.from({ length: MANY_RECIPIENTS - 1 }, (_unused, index) => {
          const person = pick(PEOPLE, hash(values["person"] ?? "") + index);

          return { address: `${person.slug}@example.org`, name: person.name };
        }),
      ];
    case "undisclosed":
      return [];
  }
}

function pick<T>(pool: readonly T[], index: number): T {
  const value = pool[((index % pool.length) + pool.length) % pool.length];
  if (value === undefined) throw new Error("A pool used by the scenarios is empty.");

  return value;
}

/** A small stable hash. Nothing cryptographic is wanted: only the same answer on every machine. */
function hash(value: string): number {
  let result = 0;

  for (const character of value) {
    result = (result * 31 + (character.codePointAt(0) ?? 0)) % 100_003;
  }

  return result;
}
