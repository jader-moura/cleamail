/** Exit codes: 0 worked, 1 something failed, 2 the command line was wrong. */
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
