import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, type ApiDecision, type ApiEmail } from "./api.js";

/**
 * Server state, all of it through TanStack Query.
 *
 * One cache, invalidated after an apply or an undo, so the page tells the truth about the mailbox
 * without a reload and without a second copy of the state in a store of our own.
 */

export const keys = {
  status: ["status"] as const,
  decisions: ["decisions"] as const,
  audit: ["audit"] as const,
  emails: (ids: readonly string[]) => ["emails", [...ids].sort().join(",")] as const,
};

export function useStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => api.status() });
}

export function useDecisions() {
  return useQuery({
    queryKey: keys.decisions,
    queryFn: async () => (await api.decisions()).decisions,
  });
}

export function useAudit() {
  return useQuery({ queryKey: keys.audit, queryFn: async () => (await api.audit()).audit });
}

/** The mail behind a set of decisions, as a map so a row can look itself up. */
export function useEmails(ids: readonly string[]): UseQueryResult<Map<string, ApiEmail>> {
  return useQuery({
    queryKey: keys.emails(ids),
    queryFn: async () => {
      const { emails } = await api.emails(ids);

      return new Map(emails.map((email) => [email.id, email]));
    },
    enabled: ids.length > 0,
  });
}

/** Everything that changed the mailbox invalidates everything that describes it. */
function useMailboxMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.decisions }),
        client.invalidateQueries({ queryKey: keys.audit }),
        client.invalidateQueries({ queryKey: keys.status }),
        client.invalidateQueries({ queryKey: ["emails"] }),
      ]);
    },
  });
}

export function useApplyRun() {
  return useMailboxMutation((runId: string) => api.apply(runId));
}

export function useUndo() {
  return useMailboxMutation((input: { runId?: string; emailId?: string }) => api.undo(input));
}

/** Decisions grouped the way the page reads them. Derived, so nothing can disagree with the API. */
export type Grouped = {
  readonly preview?: { readonly runId: string; readonly decisions: readonly ApiDecision[] };
  readonly needsAttention: readonly ApiDecision[];
  readonly cleaned: readonly ApiDecision[];
  readonly review: readonly ApiDecision[];
};

const ATTENTION = ["important", "needs_reply"];

export function group(decisions: readonly ApiDecision[]): Grouped {
  // The newest dry run is the thing waiting for an answer. Older previews are history: approving
  // one would plan from before-states that have moved on, and the server refuses it anyway.
  const previews = decisions.filter((decision) => decision.dryRun);
  const latestRun = previews[0]?.runId;
  const preview =
    latestRun === undefined
      ? undefined
      : {
          runId: latestRun,
          decisions: previews.filter((decision) => decision.runId === latestRun),
        };

  const applied = decisions.filter((decision) => !decision.dryRun);

  return {
    ...(preview === undefined ? {} : { preview }),
    needsAttention: applied.filter(
      (decision) =>
        decision.reviewReason === undefined &&
        decision.category !== undefined &&
        ATTENTION.includes(decision.category),
    ),
    cleaned: applied.filter((decision) =>
      decision.actions.some((action) => action.type === "archive" || action.type === "trash"),
    ),
    review: applied.filter((decision) => decision.reviewReason !== undefined),
  };
}
