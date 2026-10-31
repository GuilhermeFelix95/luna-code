import { describe, expect, it } from "vitest";
import {
  MAX_COLS,
  MAX_ROWS,
  MAX_WRITE_CHARS,
  parseSessionId,
  parseSize,
  parseText,
} from "./terminal-validation";

describe("parseSize", () => {
  it("aceita tamanhos dentro dos limites", () => {
    expect(parseSize(80, 24)).toEqual({ cols: 80, rows: 24 });
    expect(parseSize(MAX_COLS, MAX_ROWS)).toEqual({
      cols: MAX_COLS,
      rows: MAX_ROWS,
    });
  });

  it("rejeita zero, negativos, fracionários e acima do limite", () => {
    expect(() => parseSize(0, 24)).toThrow("colunas");
    expect(() => parseSize(80, -1)).toThrow("linhas");
    expect(() => parseSize(80.5, 24)).toThrow("colunas");
    expect(() => parseSize(MAX_COLS + 1, 24)).toThrow("colunas");
  });

  it("rejeita tipos que não são número", () => {
    expect(() => parseSize("80", 24)).toThrow("colunas");
    expect(() => parseSize(80, undefined)).toThrow("linhas");
  });
});

describe("parseSessionId", () => {
  it("aceita inteiro positivo", () => {
    expect(parseSessionId(7)).toBe(7);
  });

  it("rejeita zero e texto", () => {
    expect(() => parseSessionId(0)).toThrow("sessionId");
    expect(() => parseSessionId("7")).toThrow("sessionId");
  });
});

describe("parseText", () => {
  it("aceita texto dentro do limite", () => {
    expect(parseText("echo oi\r")).toBe("echo oi\r");
  });

  it("rejeita o que não é texto", () => {
    expect(() => parseText(42)).toThrow("texto");
  });

  it("rejeita texto acima do limite", () => {
    expect(() => parseText("x".repeat(MAX_WRITE_CHARS + 1))).toThrow("limite");
  });
});
