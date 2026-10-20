import type { Result } from "@cleamail/core";
import { OllamaClient, type OllamaClientOptions } from "./client.js";

/**
 * Is Ollama there, and what has it pulled?
 *
 * Moved here from `apps/cli` in SPEC-008 so it sits next to the client it uses. `init` and `status`
 * both need to tell the user whether the local model server is running before anything else is
 * worth attempting.
 */
export async function checkOllama(
  options: OllamaClientOptions = {},
): Promise<Result<readonly string[]>> {
  const client = OllamaClient.create(options);
  if (!client.ok) return client;

  return client.value.listModels();
}

/**
 * Whether a wanted model is among those installed.
 *
 * Ollama reports an untagged model as `name:latest`, so `minicpm-v` has to match `minicpm-v:latest`
 * while `qwen3-vl:8b` must not match `qwen3-vl:8b-instruct`.
 */
export function hasModel(installed: readonly string[], wanted: string): boolean {
  const normalized = wanted.includes(":") ? wanted : `${wanted}:latest`;

  return installed.some((name) => (name.includes(":") ? name : `${name}:latest`) === normalized);
}
