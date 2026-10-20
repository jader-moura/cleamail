/**
 * Builds the Gmail search query for a fetch window.
 *
 * Gmail's `after:` takes whole days in the account's timezone, so the query is deliberately one day
 * wider than asked and the caller filters precisely on `receivedAt`. Fetching a few messages too
 * many is harmless; missing one is not.
 */
export function buildFetchQuery(since: Date): string {
  const widened = new Date(since.getTime() - 24 * 60 * 60 * 1000);

  const year = widened.getUTCFullYear();
  const month = `${widened.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${widened.getUTCDate()}`.padStart(2, "0");

  // `-in:chats` keeps Google Chat messages out; they are not email and have no useful headers.
  return `after:${year}/${month}/${day} -in:chats`;
}
