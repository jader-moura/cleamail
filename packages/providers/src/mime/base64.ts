/**
 * Gmail returns body data as base64url. Decoding is deliberately forgiving: a message body that
 * cannot be decoded must not lose the message, so the caller gets an empty string and the email is
 * still classified on its headers and subject.
 */
export function decodeBase64Url(data: string): string {
  if (data === "") return "";

  const normalized = data.replaceAll("-", "+").replaceAll("_", "/");

  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}
