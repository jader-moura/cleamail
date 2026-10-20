/** Time is injected so the trash rule and `--since` parsing are testable without waiting. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at.getTime()) };
}
