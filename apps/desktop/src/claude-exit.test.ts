import { describe, expect, it, vi } from "vitest";
import type { SidecarEvent } from "./sidecar-protocol";
import { CLAUDE_EXIT_COMMAND, exitClaudeSessions } from "./claude-exit";

function fakeBackend(): {
  writeTerminal: ReturnType<typeof vi.fn>;
  onEvent: (listener: (event: SidecarEvent) => void) => () => void;
  emit: (event: SidecarEvent) => void;
} {
  const listeners: Array<(event: SidecarEvent) => void> = [];
  return {
    writeTerminal: vi.fn(async () => undefined),
    onEvent: (listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    emit: (event) => listeners.forEach((listener) => listener(event)),
  };
}

describe("exitClaudeSessions", () => {
  it("envia /exit para cada sessão do Claude", async () => {
    const backend = fakeBackend();

    void exitClaudeSessions([3, 4], backend, 10);

    expect(backend.writeTerminal).toHaveBeenCalledWith(3, CLAUDE_EXIT_COMMAND);
    expect(backend.writeTerminal).toHaveBeenCalledWith(4, CLAUDE_EXIT_COMMAND);
  });

  it("termina assim que todas as sessões informam pty.exit", async () => {
    const backend = fakeBackend();
    const done = exitClaudeSessions([3, 4], backend, 60_000);

    backend.emit({ event: "pty.exit", sessionId: 3, code: 0 });
    backend.emit({ event: "pty.exit", sessionId: 4, code: 0 });

    await expect(done).resolves.toBeUndefined();
  });

  it("desiste depois do tempo de espera se o Claude não sair", async () => {
    const backend = fakeBackend();

    await expect(exitClaudeSessions([3], backend, 10)).resolves.toBeUndefined();
  });

  it("não aceita pty.exit de sessão que não foi pedida", async () => {
    const backend = fakeBackend();
    const done = exitClaudeSessions([3], backend, 20);

    backend.emit({ event: "pty.exit", sessionId: 99, code: 0 });

    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(finished).toBe(false);
    await done;
  });
});
