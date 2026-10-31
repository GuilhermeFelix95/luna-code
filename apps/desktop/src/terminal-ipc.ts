import type { IpcMain } from "electron";
import type { ProcessSpec } from "./sidecar-client";
import type { SidecarEvent } from "./sidecar-protocol";
import {
  TERMINAL_CHANNELS,
  type TerminalExitPayload,
  type TerminalKind,
  type TerminalOutputPayload,
} from "./terminal-api";
import {
  parseSessionId,
  parseSize,
  parseTerminalKind,
  parseText,
} from "./terminal-validation";

/** Recorte do SidecarClient usado pelo terminal, para permitir teste com dublê. */
export interface TerminalBackend {
  spawnTerminal(cols: number, rows: number, spec: ProcessSpec): Promise<number>;
  writeTerminal(sessionId: number, data: string): Promise<void>;
  resizeTerminal(sessionId: number, cols: number, rows: number): Promise<void>;
  killTerminal(sessionId: number): Promise<void>;
  onEvent(listener: (event: SidecarEvent) => void): () => void;
}

export type SendToRenderer = (channel: string, payload: unknown) => void;

/** Traduz o tipo pedido pelo renderer no programa real. Vem do processo principal. */
export type SpecForKind = (kind: TerminalKind) => ProcessSpec;

export function registerTerminalIpc(
  ipc: IpcMain,
  backend: TerminalBackend,
  specForKind: SpecForKind,
): void {
  ipc.handle(
    TERMINAL_CHANNELS.spawn,
    (_event, kind: unknown, cols: unknown, rows: unknown) => {
      const terminalKind = parseTerminalKind(kind);
      const size = parseSize(cols, rows);
      return backend.spawnTerminal(
        size.cols,
        size.rows,
        specForKind(terminalKind),
      );
    },
  );

  ipc.handle(
    TERMINAL_CHANNELS.write,
    (_event, sessionId: unknown, data: unknown) =>
      backend.writeTerminal(parseSessionId(sessionId), parseText(data)),
  );

  ipc.handle(
    TERMINAL_CHANNELS.resize,
    (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
      const size = parseSize(cols, rows);
      return backend.resizeTerminal(
        parseSessionId(sessionId),
        size.cols,
        size.rows,
      );
    },
  );

  ipc.handle(TERMINAL_CHANNELS.kill, (_event, sessionId: unknown) =>
    backend.killTerminal(parseSessionId(sessionId)),
  );
}

/** Envia saída e fim de processo do sidecar para o renderer. */
export function forwardTerminalEvents(
  backend: TerminalBackend,
  send: SendToRenderer,
): () => void {
  return backend.onEvent((event) => {
    if (event.event === "pty.output") {
      const payload: TerminalOutputPayload = {
        sessionId: event.sessionId,
        data: event.data,
      };
      send(TERMINAL_CHANNELS.output, payload);
      return;
    }

    const payload: TerminalExitPayload = {
      sessionId: event.sessionId,
      code: event.code,
    };
    send(TERMINAL_CHANNELS.exit, payload);
  });
}
