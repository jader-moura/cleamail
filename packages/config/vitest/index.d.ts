import type { UserConfig } from "vitest/config";

/** Shared node test defaults (environment, include globs, coverage). */
declare const nodeDefaults: UserConfig;

export declare function defineNodeConfig(overrides?: UserConfig): UserConfig;

/** The same, with a DOM and .tsx tests, for the dashboard. */
export declare function defineReactConfig(overrides?: UserConfig): UserConfig;

export default nodeDefaults;
