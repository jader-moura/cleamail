import { describe, expect, it } from "vitest";
import { parseAddress, parseAddressList } from "./addresses.js";
import { decodeBase64Url } from "./base64.js";
import { MAX_BODY_CHARS, htmlToText, normalizeText, selectBodyText } from "./body.js";
import { decodeEncodedWords } from "./rfc2047.js";

describe("decodeBase64Url", () => {
  it("decodes the url-safe alphabet Gmail uses", () => {
    const encoded = Buffer.from("héllo + world", "utf8").toString("base64url");

    expect(decodeBase64Url(encoded)).toBe("héllo + world");
  });

  it("returns empty for empty input", () => {
    expect(decodeBase64Url("")).toBe("");
  });
});

describe("decodeEncodedWords", () => {
  it("leaves plain text alone", () => {
    expect(decodeEncodedWords("Your invoice")).toBe("Your invoice");
  });

  it("decodes base64 encoded words", () => {
    const encoded = Buffer.from("Faktura för oktober", "utf8").toString("base64");

    expect(decodeEncodedWords(`=?UTF-8?B?${encoded}?=`)).toBe("Faktura för oktober");
  });

  it("decodes quoted-printable encoded words, including the underscore space", () => {
    expect(decodeEncodedWords("=?utf-8?Q?Rechnung_f=C3=BCr_Oktober?=")).toBe(
      "Rechnung für Oktober",
    );
  });

  it("decodes several words in one header", () => {
    expect(decodeEncodedWords("=?utf-8?Q?a=C3=A9?= and =?utf-8?Q?b=C3=A8?=")).toBe("aé and bè");
  });

  it("keeps a malformed encoded word rather than dropping the subject", () => {
    expect(decodeEncodedWords("=?UTF-8?X?zzz?=")).toBe("=?UTF-8?X?zzz?=");
  });
});

describe("parseAddress", () => {
  it("parses a bare address", () => {
    expect(parseAddress("news@shop.example")).toStrictEqual({ address: "news@shop.example" });
  });

  it("parses a display name", () => {
    expect(parseAddress("Shop News <news@shop.example>")).toStrictEqual({
      address: "news@shop.example",
      name: "Shop News",
    });
  });

  it("unquotes a display name containing a comma", () => {
    expect(parseAddress('"Doe, Jane" <jane@example.com>')).toStrictEqual({
      address: "jane@example.com",
      name: "Doe, Jane",
    });
  });

  it("decodes an encoded display name", () => {
    const encoded = Buffer.from("Zoë", "utf8").toString("base64");

    expect(parseAddress(`=?UTF-8?B?${encoded}?= <zoe@example.com>`)).toStrictEqual({
      address: "zoe@example.com",
      name: "Zoë",
    });
  });

  it("ignores a trailing comment after a bare address", () => {
    expect(parseAddress("support@example.com (Support)")).toStrictEqual({
      address: "support@example.com",
    });
  });

  it("returns undefined for nothing usable", () => {
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("   ")).toBeUndefined();
    expect(parseAddress("<>")).toBeUndefined();
  });
});

describe("parseAddressList", () => {
  it("splits on commas outside quotes and angle brackets", () => {
    expect(parseAddressList('a@b.c, "Doe, Jane" <jane@example.com>; c@d.e')).toStrictEqual([
      { address: "a@b.c" },
      { address: "jane@example.com", name: "Doe, Jane" },
      { address: "c@d.e" },
    ]);
  });

  it("returns an empty list for a missing or blank header", () => {
    expect(parseAddressList(undefined)).toStrictEqual([]);
    expect(parseAddressList("  ")).toStrictEqual([]);
  });
});

describe("normalizeText", () => {
  it("collapses whitespace and blank lines", () => {
    expect(normalizeText("  a \t b\r\n\n\n\nc  ")).toBe("a b\n\nc");
  });
});

describe("htmlToText", () => {
  it("keeps the text and drops the markup, images and link targets", () => {
    const html = '<p>Hello <b>you</b></p><img src="x.png"><a href="https://t.example">Click</a>';

    const text = htmlToText(html);

    expect(text).toContain("Hello you");
    expect(text).toContain("Click");
    expect(text).not.toContain("https://t.example");
    expect(text).not.toContain("<p>");
  });
});

describe("selectBodyText", () => {
  it("prefers the plain text alternative", () => {
    const text = selectBodyText([
      { mimeType: "text/plain", filename: "", text: "Plain version" },
      { mimeType: "text/html", filename: "", text: "<p>HTML version</p>" },
    ]);

    expect(text).toBe("Plain version");
  });

  it("falls back to converted HTML", () => {
    expect(
      selectBodyText([{ mimeType: "text/html", filename: "", text: "<p>Only HTML</p>" }]),
    ).toBe("Only HTML");
  });

  it("ignores attachments", () => {
    expect(
      selectBodyText([
        { mimeType: "text/plain", filename: "notes.txt", text: "attachment text" },
        { mimeType: "text/plain", filename: "", text: "body text" },
      ]),
    ).toBe("body text");
  });

  it("returns empty when there is nothing readable", () => {
    expect(selectBodyText([])).toBe("");
    expect(selectBodyText([{ mimeType: "image/png", filename: "", text: "binary" }])).toBe("");
  });

  it("truncates a body that is far longer than any classifier needs", () => {
    const long = "x".repeat(MAX_BODY_CHARS + 500);

    const text = selectBodyText([{ mimeType: "text/plain", filename: "", text: long }]);

    expect(text.length).toBeLessThan(long.length);
    expect(text.endsWith("[truncated]")).toBe(true);
  });
});
