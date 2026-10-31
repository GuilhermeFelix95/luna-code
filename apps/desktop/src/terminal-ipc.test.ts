import { describe, expect, it, vi } from "vitest";
import { TERMINAL_CHANNELS } from "./terminal-api";
import {
  forwardTerminalEvents,
  registerTerminalIpc,
  type TerminalBackend,
} from "./terminal-ipc";
import type { SidecarEvent } from "./sidecar-protocol";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc(): {
  handle: (channel: string, handler: Handler) => void;
  call: (channel: string, ...args: unknown[]) => unknown;
} {
  const handlers = new Map<string, Handler>();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    call: (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`canal não registrado: ${channel}`);
      }
      return handler({}, ...args);
    },
  };
}

function fakeBackend(): TerminalBackend & {
  listeners: Array<(event: SidecarEvent) => void>;
} {
  const listeners: Array<(event: SidecarEvent) => void> = [];
  return {
    listeners,
    spawnTerminal: vi.fn(async () => 7),
    writeTerminal: vi.fn(async () => undefined),
    resizeTerminal: vi.fn(async () => undefined),
    killTerminal: vi.fn(async () => undefined),
    onEvent: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
}

describe("registerTerminalIpc", () => {
  it("spawn valida o tamanho e repassa ao backend", async () => {
    const ipc = fakeIpc();
    const backend = fakeBackend();
    registerTerminalIpc(ipc as never, backend);

    await expect(ipc.call(TERMINAL_CHANNELS.spawn, 80, 24)).resolves.toBe(7);
    expect(backend.spawnTerminal).toHaveBeenCalledWith(80, 24);
  });

  it("spawn rejeita tamanho inválido sem chamar o backend", () => {
    const ipc = fakeIpc();
    const backend = fakeBackend();
    registerTerminalIpc(ipc as never, backend);

    expect(() => ipc.call(TERMINAL_CHANNELS.spawn, 0, 24)).toThrow("colunas");
    expect(backend.spawnTerminal).not.toHaveBeenCalled();
  });

  it("write valida sessionId e texto antes de repassar", async () => {
    const ipc = fakeIpc();
    const backend = fakeBackend();
    registerTerminalIpc(ipc as never, backend);

    await ipc.call(TERMINAL_CHANNELS.write, 7, "ls\r");
    expect(backend.writeTerminal).toHaveBeenCalledWith(7, "ls\r");

    expect(() => ipc.call(TERMINAL_CHANNELS.write, "7", "ls")).toThrow(
      "sessionId",
    );
    expect(() => ipc.call(TERMINAL_CHANNELS.write, 7, 1)).toThrow("texto");
  });

  it("resize e kill validam e repassam os argumentos", async () => {
    const ipc = fakeIpc();
    const backend = fakeBackend();
    registerTerminalIpc(ipc as never, backend);

    await ipc.call(TERMINAL_CHANNELS.resize, 7, 100, 30);
    expect(backend.resizeTerminal).toHaveBeenCalledWith(7, 100, 30);

    await ipc.call(TERMINAL_CHANNELS.kill, 7);
    expect(backend.killTerminal).toHaveBeenCalledWith(7);
  });
});

describe("forwardTerminalEvents", () => {
  it("envia saída e fim de processo para o renderer nos canais certos", () => {
    const backend = fakeBackend();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    forwardTerminalEvents(backend, (channel, payload) =>
      sent.push({ channel, payload }),
    );

    backend.listeners[0]({ event: "pty.output", sessionId: 7, data: "b2k=" });
    backend.listeners[0]({ event: "pty.exit", sessionId: 7, code: 0 });

    expect(sent).toEqual([
      {
        channel: TERMINAL_CHANNELS.output,
        payload: { sessionId: 7, data: "b2k=" },
      },
      {
        channel: TERMINAL_CHANNELS.exit,
        payload: { sessionId: 7, code: 0 },
      },
    ]);
  });
});
