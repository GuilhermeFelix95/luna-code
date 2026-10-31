import { describe, expect, it, vi } from "vitest";
import { CHAT_CHANNELS, type RunnerEvent } from "./chat-api";
import {
  MAX_CONVERSATION_ID_LENGTH,
  registerChatIpc,
  type StartTurn,
  type TurnRequest,
} from "./chat-ipc";

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

/** Turno que entrega os eventos dados e só termina quando liberado. */
function controlledTurn(events: RunnerEvent[]): {
  startTurn: StartTurn;
  requests: TurnRequest[];
  release: () => void;
} {
  const requests: TurnRequest[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startTurn: StartTurn = (request) => {
    requests.push(request);
    return (async function* () {
      for (const event of events) {
        yield event;
      }
      await gate;
    })();
  };
  return { startTurn, requests, release };
}

describe("registerChatIpc", () => {
  it("envia os eventos do turno ao renderer com o id da conversa", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    const turn = controlledTurn([
      { type: "text-delta", text: "oi" },
      { type: "turn-end", ok: true, text: "oi" },
    ]);
    registerChatIpc(ipc as never, turn.startTurn, sent);

    ipc.call(CHAT_CHANNELS.send, "conv-1", "olá");
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));

    expect(sent).toHaveBeenNthCalledWith(1, CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: { type: "text-delta", text: "oi" },
    });
    expect(turn.requests[0].prompt).toBe("olá");
    turn.release();
  });

  it("guarda a sessão do Claude e a usa no turno seguinte", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    let turns = 0;
    const startTurn: StartTurn = () => {
      turns += 1;
      return (async function* () {
        yield { type: "session" as const, sessionId: "sessao-1" };
        yield { type: "turn-end" as const, ok: true, text: `turno ${turns}` };
      })();
    };
    const seen: Array<string | undefined> = [];
    const recording: StartTurn = (request) => {
      seen.push(request.sessionId);
      return startTurn(request);
    };
    registerChatIpc(ipc as never, recording, sent);

    ipc.call(CHAT_CHANNELS.send, "conv-1", "primeira");
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    ipc.call(CHAT_CHANNELS.send, "conv-1", "segunda");
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(4));

    expect(seen).toEqual([undefined, "sessao-1"]);
  });

  it("recusa segundo envio enquanto a conversa ainda responde", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(ipc as never, turn.startTurn, vi.fn());

    ipc.call(CHAT_CHANNELS.send, "conv-1", "primeira");

    expect(() => ipc.call(CHAT_CHANNELS.send, "conv-1", "segunda")).toThrow(
      "em andamento",
    );
    turn.release();
  });

  it("recusa mensagem vazia sem iniciar turno", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(ipc as never, turn.startTurn, vi.fn());

    expect(() => ipc.call(CHAT_CHANNELS.send, "conv-1", "   ")).toThrow(
      "não pode estar vazia",
    );
    expect(turn.requests).toEqual([]);
  });

  it("recusa conversationId inválido", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(ipc as never, turn.startTurn, vi.fn());

    expect(() => ipc.call(CHAT_CHANNELS.send, "", "oi")).toThrow(
      "conversationId",
    );
    expect(() =>
      ipc.call(
        CHAT_CHANNELS.send,
        "x".repeat(MAX_CONVERSATION_ID_LENGTH + 1),
        "oi",
      ),
    ).toThrow("conversationId");
    expect(() => ipc.call(CHAT_CHANNELS.send, 7, "oi")).toThrow(
      "conversationId",
    );
  });

  it("parar aborta o turno e avisa o renderer que terminou", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    const turn = controlledTurn([]);
    registerChatIpc(ipc as never, turn.startTurn, sent);

    ipc.call(CHAT_CHANNELS.send, "conv-1", "longa");
    ipc.call(CHAT_CHANNELS.stop, "conv-1");
    turn.release();

    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(turn.requests[0].abortController.signal.aborted).toBe(true);
    expect(sent).toHaveBeenCalledWith(CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: { type: "turn-end", ok: false, text: "Resposta interrompida." },
    });
  });

  it("erro inesperado vira fim de turno com falha, sem silêncio", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    // Falha antes do primeiro evento, como um processo do Claude que não inicia.
    const failing: AsyncIterable<RunnerEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("sem login")),
      }),
    };
    const startTurn: StartTurn = () => failing;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerChatIpc(ipc as never, startTurn, sent);

    ipc.call(CHAT_CHANNELS.send, "conv-1", "oi");

    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(sent).toHaveBeenCalledWith(CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: { type: "turn-end", ok: false, text: "sem login" },
    });
    vi.restoreAllMocks();
  });
});
