// Encerramento gracioso das sessões do Claude Code. O Claude só grava a configuração
// (onboarding, confiança da pasta) quando sai por conta própria; matar o processo perde isso.

import type { SidecarEvent } from "./sidecar-protocol";

export const CLAUDE_EXIT_COMMAND = "/exit\r";

export interface ExitBackend {
  writeTerminal(sessionId: number, data: string): Promise<void>;
  onEvent(listener: (event: SidecarEvent) => void): () => void;
}

/**
 * Pede `/exit` às sessões e espera o `pty.exit` de todas, ou até `graceMs`.
 * Quem chama decide o que fazer depois (matar o processo, se ainda estiver vivo).
 */
export async function exitClaudeSessions(
  sessionIds: readonly number[],
  backend: ExitBackend,
  graceMs: number,
): Promise<void> {
  if (sessionIds.length === 0) {
    return;
  }

  const running = new Set(sessionIds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;

  const allExited = new Promise<void>((resolve) => {
    stop = backend.onEvent((event) => {
      if (event.event === "pty.exit" && running.delete(event.sessionId)) {
        if (running.size === 0) {
          resolve();
        }
      }
    });
  });
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, graceMs);
  });

  try {
    await Promise.all(
      sessionIds.map((id) => backend.writeTerminal(id, CLAUDE_EXIT_COMMAND)),
    );
    await Promise.race([allExited, grace]);
  } finally {
    clearTimeout(timer);
    stop?.();
  }
}
