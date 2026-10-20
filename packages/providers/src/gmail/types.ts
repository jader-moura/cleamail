import { z } from "zod";

/**
 * Gmail payload shapes, as Zod schemas.
 *
 * Everything here is untrusted input from the network, so it is validated before anything touches
 * the mapper. The schemas are deliberately tolerant about missing fields (Gmail omits plenty) and
 * strict about the few the mapper relies on.
 */

export const GmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string().default(""),
});
export type GmailHeader = z.infer<typeof GmailHeaderSchema>;

export const GmailBodySchema = z.object({
  data: z.string().optional(),
  size: z.number().optional(),
  attachmentId: z.string().optional(),
});

export type GmailPart = {
  // `| undefined` spelled out: the repo runs `exactOptionalPropertyTypes`, and the recursive Zod
  // schema below only lines up with the type when optional means "may be present and undefined".
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: GmailHeader[] | undefined;
  body?: z.infer<typeof GmailBodySchema> | undefined;
  parts?: GmailPart[] | undefined;
};

export const GmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(GmailHeaderSchema).optional(),
    body: GmailBodySchema.optional(),
    parts: z.array(GmailPartSchema).optional(),
  }),
);

export const GmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(""),
  /** Milliseconds since the epoch, as a string. Gmail's own receive time. */
  internalDate: z.string().optional(),
  sizeEstimate: z.number().optional(),
  payload: GmailPartSchema.optional(),
});
export type GmailMessage = z.infer<typeof GmailMessageSchema>;

export const GmailLabelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type GmailLabel = z.infer<typeof GmailLabelSchema>;

export const GmailMessageRefSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1).optional(),
});

export const GmailListResponseSchema = z.object({
  messages: z.array(GmailMessageRefSchema).default([]),
  nextPageToken: z.string().optional(),
});
export type GmailListResponse = z.infer<typeof GmailListResponseSchema>;

export const GmailProfileSchema = z.object({
  emailAddress: z.string().min(1),
});
export type GmailProfile = z.infer<typeof GmailProfileSchema>;

export type ListMessagesParams = {
  readonly query: string;
  readonly maxResults?: number;
  readonly pageToken?: string;
};

export type LabelChanges = {
  readonly addLabelIds?: readonly string[];
  readonly removeLabelIds?: readonly string[];
};

/**
 * The narrow slice of the Gmail API cleamail uses.
 *
 * Keeping it this small is a safety feature as much as a testing one: there is no send, no delete
 * and no draft method here, so no amount of refactoring can reach for one. Implementations throw;
 * the provider converts failures into typed results.
 */
export interface GmailApi {
  getProfile(): Promise<GmailProfile>;

  listMessages(params: ListMessagesParams): Promise<GmailListResponse>;

  getMessage(id: string): Promise<GmailMessage>;

  modifyMessage(id: string, changes: LabelChanges): Promise<void>;

  /** Moves to Trash. Gmail keeps it for 30 days, which is what makes undo possible. */
  trashMessage(id: string): Promise<void>;

  untrashMessage(id: string): Promise<void>;

  listLabels(): Promise<GmailLabel[]>;

  createLabel(name: string): Promise<GmailLabel>;
}
