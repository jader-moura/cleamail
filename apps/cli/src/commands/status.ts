import type { CliDeps } from "../deps.js";
import { EXIT } from "../exit.js";
import { requireAccount } from "./account.js";

function formatDate(date: Date | undefined): string {
  return date === undefined ? "never" : date.toISOString();
}

/** What is connected, what is stored, and whether the local model server is up. */
export async function statusCommand(deps: CliDeps): Promise<number> {
  const account = await requireAccount(deps);

  deps.out(`database   ${deps.store.path}`);

  if (!account.ok) {
    deps.out("mailbox    not connected");
    deps.out("");
    deps.out(account.error.message);

    return EXIT.ok;
  }

  const counted = await deps.store.emails.countEmails(account.value.id);
  const lastSync = await deps.store.emails.lastSyncAt(account.value.id);

  deps.out(`mailbox    ${account.value.address} (${account.value.kind})`);
  deps.out(`messages   ${counted.ok ? counted.value : "unknown"}`);
  deps.out(`last sync  ${lastSync.ok ? formatDate(lastSync.value) : "unknown"}`);

  const ollama = await deps.checkOllama();
  deps.out(
    ollama.ok
      ? `ollama     running (${ollama.value.length} model${ollama.value.length === 1 ? "" : "s"})`
      : "ollama     not reachable",
  );

  return EXIT.ok;
}
