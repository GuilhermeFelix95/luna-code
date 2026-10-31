import { describe, expect, it } from "vitest";
import { decodeBase64 } from "./terminal-api";

describe("decodeBase64", () => {
  it("devolve os bytes originais, inclusive UTF-8 multibyte", () => {
    const bytes = new TextEncoder().encode("oi ção ✓\r\n");
    const encoded = Buffer.from(bytes).toString("base64");

    expect(decodeBase64(encoded)).toEqual(bytes);
  });
});
