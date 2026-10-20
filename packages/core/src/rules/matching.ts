import { addressDomain, type EmailAddress } from "../domain/email.js";

/**
 * Matches a sender against a user list entry.
 *
 * An entry is either a full address (`alerts@bank.example`) or a bare domain (`bank.example`), and
 * a domain entry covers its subdomains. Nothing clever beyond that: a list the user cannot predict
 * the behaviour of is worse than no list.
 */
export function matchesListEntry(address: EmailAddress, entry: string): boolean {
  const candidate = address.address.trim().toLowerCase();
  const pattern = entry.trim().toLowerCase().replace(/^@/, "");

  if (pattern === "" || candidate === "") return false;
  if (pattern.includes("@")) return candidate === pattern;

  const domain = addressDomain(address);
  if (domain === undefined) return false;

  return domain === pattern || domain.endsWith(`.${pattern}`);
}

export function findListEntry(
  address: EmailAddress,
  entries: readonly string[] | undefined,
): string | undefined {
  return entries?.find((entry) => matchesListEntry(address, entry));
}

/** Pulls an address out of a display name, which is how spoofed senders usually read. */
export function addressInText(text: string): string | undefined {
  const match = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text);

  return match?.[0]?.toLowerCase();
}
