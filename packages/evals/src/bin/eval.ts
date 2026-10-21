#!/usr/bin/env node
import { evalCommand } from "../command.js";

/**
 * The entry point for `pnpm eval`.
 *
 * Thin on purpose: everything worth testing lives in `command.ts`, which takes its output and its
 * classifier as arguments. This file is the only part that cannot be tested without a terminal.
 */
const code = await evalCommand({
  argv: process.argv.slice(2),
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
  env: process.env,
  now: () => new Date(),
  progress: (line) => {
    // Only when something is watching: in a log or a pipe, a line that rewrites itself is noise.
    if (process.stdout.isTTY) process.stdout.write(`\r${line.padEnd(40)}`);
  },
});

process.exit(code);
