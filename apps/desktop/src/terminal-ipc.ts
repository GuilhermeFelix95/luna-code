import type { IpcMain } from "electron";
import { exitClaudeSessions } from "./claude-exit";
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

/** Tempo que o Claude tem para sair sozinho e gravar a configuração antes do kill. */
const CLAUDE_EXIT_GRACE_MS = 2000;

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

export interface TerminalIpc {
  /** Encerra todas as sessões em execução. O Claude sai sozinho; os demais são mortos. */
  closeAll(): Promise<void>;
}

export function registerTerminalIpc(
  ipc: IpcMain,
  backend: TerminalBackend,
  specForKind: SpecForKind,
): TerminalIpc {
  // Sessões ainda em execução e o tipo de cada uma. Some quando o processo termina.
  const running = new Map<number, TerminalKind>();
  backend.onEvent((event) => {
    if (event.event === "pty.exit") {
      running.delete(event.sessionId);
    }
  });

  async function closeSession(sessionId: number): Promise<void> {
    const kind = running.get(sessionId);
    try {
      if (kind === "claude") {
        await exitClaudeSessions([sessionId], backend, CLAUDE_EXIT_GRACE_MS);
      }
    } finally {
      running.delete(sessionId);
      await backend.killTerminal(sessionId);
    }
  }

  ipc.handle(
    TERMINAL_CHANNELS.spawn,
    async (_event, kind: unknown, cols: unknown, rows: unknown) => {
      const terminalKind = parseTerminalKind(kind);
      const size = parseSize(cols, rows);
      const sessionId = await backend.spawnTerminal(
        size.cols,
        size.rows,
        specForKind(terminalKind),
      );
      running.set(sessionId, terminalKind);
      return sessionId;
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

  ipc.handle(TERMINAL_CHANNELS.close, (_event, sessionId: unknown) =>
    closeSession(parseSessionId(sessionId)),
  );

  return {
    async closeAll() {
      const sessions = [...running];
      const claudeIds = sessions
        .filter(([, kind]) => kind === "claude")
        .map(([id]) => id);
      try {
        await exitClaudeSessions(claudeIds, backend, CLAUDE_EXIT_GRACE_MS);
      } finally {
        running.clear();
        await Promise.all(sessions.map(([id]) => backend.killTerminal(id)));
      }
    },
  };
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
