import { hasModel } from "@cleamail/llm";
import { canModify } from "@cleamail/providers";
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

  if (account.ok) {
    const counted = await deps.store.emails.countEmails(account.value.id);
    const lastSync = await deps.store.emails.lastSyncAt(account.value.id);

    deps.out(`mailbox    ${account.value.address} (${account.value.kind})`);

    // Read back off the stored token rather than from a setting, because the only thing that
    // decides what cleamail can do is what Google actually granted.
    const token = await deps.tokens.get(account.value.id);
    deps.out(
      `access     ${
        token.ok && token.value !== undefined
          ? canModify(token.value.scopes)
            ? "read and change labels"
            : "read-only (cannot change your mailbox)"
          : "unknown"
      }`,
    );

    deps.out(`messages   ${counted.ok ? counted.value : "unknown"}`);
    deps.out(`last sync  ${lastSync.ok ? formatDate(lastSync.value) : "unknown"}`);
  } else {
    deps.out("mailbox    not connected");
  }

  // The model lines print either way. Someone who has not connected a mailbox yet is exactly the
  // person who needs to know whether their model is ready, so an early return here would hide it
  // from the only user who is still setting up.
  const ollama = await deps.checkOllama();
  deps.out(
    ollama.ok
      ? `ollama     running (${ollama.value.length} model${ollama.value.length === 1 ? "" : "s"})`
      : "ollama     not reachable",
  );

  // The model is a setting, so it is worth printing: a user who overrode it should be able to see
  // that cleamail agrees, and one who has not pulled it should find out here rather than mid-run.
  const installed = ollama.ok && hasModel(ollama.value, deps.classifierModel);
  deps.out(
    `model      ${deps.classifierModel}${ollama.ok ? (installed ? "" : " (not pulled yet)") : ""}`,
  );

  if (ollama.ok && !installed) {
    deps.out("");
    deps.out(`Pull it with: ollama pull ${deps.classifierModel}`);
  }

  if (!account.ok) {
    deps.out("");
    deps.out(account.error.message);
  }

  return EXIT.ok;
}
