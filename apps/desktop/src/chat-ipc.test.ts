import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  CHAT_CHANNELS,
  type ChatModel,
  type ChatSettings,
  type RunnerEvent,
} from "./chat-api";
import {
  MAX_CONVERSATION_ID_LENGTH,
  MAX_MODEL_LENGTH,
  registerChatIpc,
  type ChatBook,
  type ListModels,
  type LoadHistory,
  type StartTurn,
  type TurnRequest,
} from "./chat-ipc";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const READONLY: ChatSettings = { mode: "readonly" };

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

const NO_MODELS: ListModels = async () => [];
const NO_HISTORY: LoadHistory = async () => [];

/** Armazenamento da conversa em memória, com as mesmas chamadas que o ConversationStore recebe. */
function memoryBook(): ChatBook & {
  turns: Array<{ id: string; prompt: string }>;
} {
  const sessions = new Map<string, string>();
  const turns: Array<{ id: string; prompt: string }> = [];
  return {
    turns,
    sessionOf: (id) => sessions.get(id),
    recordSession: (id, sessionId) => sessions.set(id, sessionId),
    recordTurn: (id, _settings, prompt) => turns.push({ id, prompt }),
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
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      sent,
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "olá", READONLY);
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));

    expect(sent).toHaveBeenNthCalledWith(1, CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: { type: "text-delta", text: "oi" },
    });
    expect(turn.requests[0].prompt).toBe("olá");
    turn.release();
  });

  it("repassa modo, modelo e esforço escolhidos ao turno", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
      mode: "ask",
      model: "opus",
      effort: "high",
    });

    expect(turn.requests[0].settings).toEqual({
      mode: "ask",
      model: "opus",
      effort: "high",
    });
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
    registerChatIpc(
      ipc as never,
      memoryBook(),
      recording,
      NO_MODELS,
      NO_HISTORY,
      sent,
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "primeira", READONLY);
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    ipc.call(CHAT_CHANNELS.send, "conv-1", "segunda", READONLY);
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(4));

    expect(seen).toEqual([undefined, "sessao-1"]);
  });

  it("recusa segundo envio enquanto a conversa ainda responde", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "primeira", READONLY);

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "segunda", READONLY),
    ).toThrow("em andamento");
    turn.release();
  });

  it("recusa mensagem vazia sem iniciar turno", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "   ", READONLY),
    ).toThrow("não pode estar vazia");
    expect(turn.requests).toEqual([]);
  });

  it("recusa conversationId inválido", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() => ipc.call(CHAT_CHANNELS.send, "", "oi", READONLY)).toThrow(
      "conversationId",
    );
    expect(() =>
      ipc.call(
        CHAT_CHANNELS.send,
        "x".repeat(MAX_CONVERSATION_ID_LENGTH + 1),
        "oi",
        READONLY,
      ),
    ).toThrow("conversationId");
    expect(() => ipc.call(CHAT_CHANNELS.send, 7, "oi", READONLY)).toThrow(
      "conversationId",
    );
  });

  it("recusa modo de permissão desconhecido", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", { mode: "root" }),
    ).toThrow("modo de permissão desconhecido");
    expect(turn.requests).toEqual([]);
  });

  it("recusa esforço fora dos cinco níveis", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
        mode: "readonly",
        effort: "turbo",
      }),
    ).toThrow("nível de esforço desconhecido");
    expect(turn.requests).toEqual([]);
  });

  it("recusa modelo vazio ou longo demais", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
        mode: "readonly",
        model: "",
      }),
    ).toThrow("modelo deve ser texto");
    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
        mode: "readonly",
        model: "m".repeat(MAX_MODEL_LENGTH + 1),
      }),
    ).toThrow("modelo deve ser texto");
  });

  it("parar aborta o turno e avisa o renderer que terminou", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      sent,
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "longa", READONLY);
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
    registerChatIpc(
      ipc as never,
      memoryBook(),
      startTurn,
      NO_MODELS,
      NO_HISTORY,
      sent,
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", READONLY);

    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(sent).toHaveBeenCalledWith(CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: { type: "turn-end", ok: false, text: "sem login" },
    });
    vi.restoreAllMocks();
  });

  it("pedido de ferramenta vai ao renderer e segue a resposta do usuário", async () => {
    const ipc = fakeIpc();
    const sent = vi.fn();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      sent,
    );
    ipc.call(CHAT_CHANNELS.send, "conv-1", "crie", { mode: "ask" });

    const signal = new AbortController().signal;
    const canUseTool = turn.requests[0].canUseTool as CanUseTool;
    const decision = canUseTool("Write", { file_path: "a.txt" }, { signal });

    expect(sent).toHaveBeenCalledWith(CHAT_CHANNELS.event, {
      conversationId: "conv-1",
      event: {
        type: "approval-request",
        requestId: "aprovacao-1",
        toolName: "Write",
        input: { file_path: "a.txt" },
      },
    });
    ipc.call(CHAT_CHANNELS.approve, "aprovacao-1", true);

    await expect(decision).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "a.txt" },
    });
    turn.release();
  });

  it("resposta negada volta ao SDK com a mensagem de negação", async () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );
    ipc.call(CHAT_CHANNELS.send, "conv-1", "apague", { mode: "ask" });

    const signal = new AbortController().signal;
    const canUseTool = turn.requests[0].canUseTool as CanUseTool;
    const decision = canUseTool("Bash", { command: "rm x" }, { signal });
    ipc.call(CHAT_CHANNELS.approve, "aprovacao-1", false);

    await expect(decision).resolves.toEqual({
      behavior: "deny",
      message: "O usuário negou esta ação.",
    });
    turn.release();
  });

  it("parar a resposta nega as aprovações que ainda estão abertas", async () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );
    ipc.call(CHAT_CHANNELS.send, "conv-1", "crie", { mode: "ask" });

    const canUseTool = turn.requests[0].canUseTool as CanUseTool;
    const decision = canUseTool(
      "Write",
      {},
      { signal: turn.requests[0].abortController.signal },
    );
    ipc.call(CHAT_CHANNELS.stop, "conv-1");

    await expect(decision).resolves.toMatchObject({ behavior: "deny" });
    turn.release();
  });

  it("aprovação já respondida ou desconhecida é recusada", () => {
    const ipc = fakeIpc();
    registerChatIpc(
      ipc as never,
      memoryBook(),
      controlledTurn([]).startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() => ipc.call(CHAT_CHANNELS.approve, "aprovacao-9", true)).toThrow(
      "desconhecida ou já respondida",
    );
  });

  it("resposta de aprovação precisa ser verdadeira ou falsa", () => {
    const ipc = fakeIpc();
    registerChatIpc(
      ipc as never,
      memoryBook(),
      controlledTurn([]).startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() => ipc.call(CHAT_CHANNELS.approve, "aprovacao-1", "sim")).toThrow(
      "verdadeira ou falsa",
    );
  });

  it("lista de modelos vem da função de listagem", async () => {
    const ipc = fakeIpc();
    const models: ChatModel[] = [
      {
        value: "opus",
        displayName: "Opus 5.5",
        supportedEffortLevels: ["low"],
      },
    ];
    registerChatIpc(
      ipc as never,
      memoryBook(),
      controlledTurn([]).startTurn,
      async () => models,
      NO_HISTORY,
      vi.fn(),
    );

    await expect(ipc.call(CHAT_CHANNELS.models)).resolves.toEqual(models);
  });

  it("grava o envio na conversa antes de começar o turno", () => {
    const ipc = fakeIpc();
    const book = memoryBook();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      book,
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "planeje a tela", {
      mode: "ask",
      planning: true,
    });

    expect(book.turns).toEqual([{ id: "conv-1", prompt: "planeje a tela" }]);
    turn.release();
  });

  it("repassa o planejamento ligado ao turno e aceita o desligado", () => {
    const ipc = fakeIpc();
    const turn = controlledTurn([]);
    registerChatIpc(
      ipc as never,
      memoryBook(),
      turn.startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
      mode: "full",
      planning: true,
    });
    turn.release();

    expect(turn.requests[0].settings).toEqual({
      mode: "full",
      planning: true,
    });
  });

  it("planejamento precisa ser verdadeiro ou falso", () => {
    const ipc = fakeIpc();
    registerChatIpc(
      ipc as never,
      memoryBook(),
      controlledTurn([]).startTurn,
      NO_MODELS,
      NO_HISTORY,
      vi.fn(),
    );

    expect(() =>
      ipc.call(CHAT_CHANNELS.send, "conv-1", "oi", {
        mode: "ask",
        planning: "sim",
      }),
    ).toThrow("planejar deve ser verdadeiro ou falso");
  });

  it("abrir conversa devolve o histórico carregado", async () => {
    const ipc = fakeIpc();
    const history = [
      { role: "user" as const, text: "oi" },
      { role: "assistant" as const, text: "olá" },
    ];
    registerChatIpc(
      ipc as never,
      memoryBook(),
      controlledTurn([]).startTurn,
      NO_MODELS,
      async (id) => (id === "conv-1" ? history : []),
      vi.fn(),
    );

    await expect(ipc.call(CHAT_CHANNELS.open, "conv-1")).resolves.toEqual(
      history,
    );
  });
});
