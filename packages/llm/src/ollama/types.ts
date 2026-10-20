import { z } from "zod";

/**
 * What Ollama sends back.
 *
 * Validated like any other external payload: Ollama is local and friendly, but it is still a
 * separate process on a version we do not control, and a silently changed field should fail loudly
 * rather than turn into `undefined` three layers down.
 */
export const OllamaChatResponseSchema = z.object({
  model: z.string().optional(),
  message: z.object({
    role: z.string(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
  /** Nanoseconds. Reported in eval runs as latency per email. */
  total_duration: z.number().optional(),
});

export type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;

export const OllamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string() })).default([]),
});

/** Sampling options. Fixed for a classifier: the same email must give the same answer. */
export type OllamaSamplingOptions = {
  readonly temperature: number;
  readonly seed: number;
  readonly num_predict: number;
};

export type OllamaChatRequest = {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  /** JSON schema passed as Ollama's structured-output constraint. */
  readonly format?: unknown;
  readonly options?: OllamaSamplingOptions;
};
