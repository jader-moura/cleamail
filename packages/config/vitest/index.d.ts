import type { UserConfig } from "vitest/config";

/** Shared node test defaults (environment, include globs, coverage). */
declare const nodeDefaults: UserConfig;

export declare function defineNodeConfig(overrides?: UserConfig): UserConfig;

export default nodeDefaults;
