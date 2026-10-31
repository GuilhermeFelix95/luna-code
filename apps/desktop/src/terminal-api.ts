// Contrato compartilhado entre o processo principal, o preload e o renderer.
// Não importa nada do Electron, para poder ser testado em Node puro.

export const TERMINAL_CHANNELS = {
  spawn: "terminal:spawn",
  write: "terminal:write",
  resize: "terminal:resize",
  kill: "terminal:kill",
  close: "terminal:close",
  output: "terminal:output",
  exit: "terminal:exit",
} as const;

/**
 * Tipos de sessão que o renderer pode pedir. O processo principal traduz cada um em
 * programa e ambiente; o renderer nunca envia um comando.
 */
export const TERMINAL_KINDS = ["shell", "claude"] as const;
export type TerminalKind = (typeof TERMINAL_KINDS)[number];

export interface TerminalOutputPayload {
  sessionId: number;
  /** Bytes da saída em base64, como vêm do sidecar. */
  data: string;
}

export interface TerminalExitPayload {
  sessionId: number;
  code: number | null;
}

/** API exposta ao renderer pelo preload. Nada além disso atravessa a fronteira. */
export interface TerminalBridge {
  spawn(kind: TerminalKind, cols: number, rows: number): Promise<number>;
  write(sessionId: number, data: string): Promise<void>;
  resize(sessionId: number, cols: number, rows: number): Promise<void>;
  /** Encerra a sessão dando ao Claude a chance de gravar a configuração antes. */
  close(sessionId: number): Promise<void>;
  kill(sessionId: number): Promise<void>;
  onOutput(listener: (payload: TerminalOutputPayload) => void): () => void;
  onExit(listener: (payload: TerminalExitPayload) => void): () => void;
}

export function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}
