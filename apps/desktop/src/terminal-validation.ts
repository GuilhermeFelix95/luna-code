// Validação dos argumentos que chegam do renderer. Nunca confiar na janela.

import { TERMINAL_KINDS, type TerminalKind } from "./terminal-api";

export const MAX_COLS = 1000;
export const MAX_ROWS = 500;
export const MAX_WRITE_CHARS = 64 * 1024;

export interface TerminalSize {
  cols: number;
  rows: number;
}

export function parseSize(cols: unknown, rows: unknown): TerminalSize {
  return {
    cols: parseInteger(cols, MAX_COLS, "colunas"),
    rows: parseInteger(rows, MAX_ROWS, "linhas"),
  };
}

export function parseTerminalKind(kind: unknown): TerminalKind {
  if (!TERMINAL_KINDS.some((known) => known === kind)) {
    throw new Error(`tipo de terminal desconhecido: ${String(kind)}`);
  }
  return kind as TerminalKind;
}

export function parseSessionId(sessionId: unknown): number {
  return parseInteger(sessionId, Number.MAX_SAFE_INTEGER, "sessionId");
}

export function parseText(data: unknown): string {
  if (typeof data !== "string") {
    throw new Error("dados do terminal devem ser texto");
  }
  if (data.length > MAX_WRITE_CHARS) {
    throw new Error(
      `escrita maior que o limite de ${MAX_WRITE_CHARS} caracteres`,
    );
  }
  return data;
}

function parseInteger(value: unknown, max: number, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new Error(`${name} deve ser um inteiro entre 1 e ${max}`);
  }
  return value;
}
