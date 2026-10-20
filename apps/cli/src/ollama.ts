import { failure, ok, type Result } from "@cleamail/core";
import { z } from "zod";

/**
 * The local model server. This lives in the CLI for now and moves into `packages/llm` in SPEC-008,
 * when there is a classifier to go with it: `init` only needs to tell the user whether Ollama is
 * running before anything else is set up.
 */
export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

const TagsSchema = z.object({
  models: z.array(z.object({ name: z.string() })).default([]),
});

export type OllamaCheck = () => Promise<Result<readonly string[]>>;

export function checkOllama(
  baseUrl: string = OLLAMA_DEFAULT_URL,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Result<readonly string[]>> {
  return request(baseUrl, fetchImpl);
}

async function request(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<Result<readonly string[]>> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      return failure("provider_unavailable", `Ollama answered with ${response.status}.`);
    }

    const parsed = TagsSchema.safeParse(await response.json());
    if (!parsed.success) {
      return failure("provider_unavailable", "Ollama returned a model list cleamail cannot read.");
    }

    return ok(parsed.data.models.map((model) => model.name));
  } catch {
    return failure(
      "provider_unavailable",
      `Could not reach Ollama at ${baseUrl}. Install it from https://ollama.com and start it.`,
    );
  }
}
