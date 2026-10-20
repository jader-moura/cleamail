import { describe, expect, it } from "vitest";
import { describeWindow, parseSince } from "./since.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");

describe("parseSince", () => {
  it("reads days", () => {
    expect(parseSince("7d", NOW)).toStrictEqual({
      ok: true,
      value: new Date("2026-10-13T12:00:00.000Z"),
    });
  });

  it("reads hours", () => {
    expect(parseSince("24h", NOW)).toStrictEqual({
      ok: true,
      value: new Date("2026-10-19T12:00:00.000Z"),
    });
  });

  it("reads an ISO date", () => {
    expect(parseSince("2026-10-01", NOW)).toStrictEqual({
      ok: true,
      value: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("refuses zero", () => {
    expect(parseSince("0d", NOW).ok).toBe(false);
  });

  it("refuses an empty value", () => {
    const parsed = parseSince("  ", NOW);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("config_invalid");
  });

  it("refuses something it cannot read, rather than guessing a window", () => {
    const parsed = parseSince("last tuesday", NOW);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.message).toContain("Try 7d");
  });
});

describe("describeWindow", () => {
  it("counts hours for short windows", () => {
    expect(describeWindow(new Date("2026-10-20T11:00:00.000Z"), NOW)).toBe("the last 1 hour");
    expect(describeWindow(new Date("2026-10-19T12:00:00.000Z"), NOW)).toBe("the last 24 hours");
  });

  it("counts days for longer ones", () => {
    expect(describeWindow(new Date("2026-10-13T12:00:00.000Z"), NOW)).toBe("the last 7 days");
  });
});
