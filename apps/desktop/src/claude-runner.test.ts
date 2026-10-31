import type {
  Options,
  Query,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import type { RunnerEvent } from "./chat-api";
import {
  buildOptions,
  listClaudeModels,
  runClaudeTurn,
  toRunnerEvents,
  type QueryFn,
  type TurnInput,
} from "./claude-runner";

const configDir = "C:\\Users\\guilh\\AppData\\Roaming\\luna-code\\claude";
const cwd = "C:\\Users\\guilh\\AppData\\Roaming\\luna-code\\workspace";
const canUseTool = vi.fn();

function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    prompt: "liste os arquivos",
    mode: "ask",
    cwd,
    configDir,
    canUseTool,
    abortController: new AbortController(),
    ...overrides,
  };
}

/** Mensagens reais têm campos extras; o teste só fornece os que o runner lê. */
function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

function fakeQuery(messages: SDKMessage[], failWith?: Error): QueryFn {
  return () => {
    async function* generate() {
      for (const item of messages) {
        yield item;
      }
      if (failWith) {
        throw failWith;
      }
    }
    return generate() as unknown as Query;
  };
}

async function collect(
  input: TurnInput,
  queryFn: QueryFn,
): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = [];
  for await (const event of runClaudeTurn(input, queryFn)) {
    events.push(event);
  }
  return events;
}

describe("buildOptions", () => {
  it("modo somente leitura nega edição e não pergunta", () => {
    const options = buildOptions(turnInput({ mode: "readonly" }));

    expect(options.permissionMode).toBe("dontAsk");
    expect(options.allowedTools).toEqual(["Read", "Glob", "Grep"]);
    expect(options.disallowedTools).toEqual(["Edit", "Write", "NotebookEdit"]);
  });

  it("modo perguntar usa o modo padrão e encaminha a aprovação", () => {
    const options = buildOptions(turnInput({ mode: "ask" }));

    expect(options.permissionMode).toBe("default");
    expect(options.canUseTool).toBe(canUseTool);
  });

  it("modo acesso total exige a confirmação explícita do SDK", () => {
    const options = buildOptions(turnInput({ mode: "full" }));

    expect(options.permissionMode).toBe("bypassPermissions");
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it("usa o perfil isolado e remove variáveis CLAUDE_* herdadas", () => {
    const options = buildOptions(turnInput(), {
      PATH: "C:\\bin",
      CLAUDE_CODE_CHILD_SESSION: "1",
    });

    expect(options.env).toEqual({
      PATH: "C:\\bin",
      CLAUDE_CONFIG_DIR: configDir,
    });
    expect(options.cwd).toBe(cwd);
  });

  it("continua a sessão anterior quando recebe sessionId", () => {
    const options: Options = buildOptions(turnInput({ sessionId: "abc-123" }));

    expect(options.resume).toBe("abc-123");
    expect(options.includePartialMessages).toBe(true);
  });
});

describe("toRunnerEvents", () => {
  it("traduz delta de texto de mensagem principal", () => {
    const events = toRunnerEvents(
      message({
        type: "stream_event",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "olá" },
        },
      }),
    );

    expect(events).toEqual([{ type: "text-delta", text: "olá" }]);
  });

  it("ignora deltas de subagente", () => {
    const events = toRunnerEvents(
      message({
        type: "stream_event",
        parent_tool_use_id: "toolu_1",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "interno" },
        },
      }),
    );

    expect(events).toEqual([]);
  });

  it("traduz chamadas de ferramenta de um bloco do assistente", () => {
    const events = toRunnerEvents(
      message({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "text", text: "vou listar" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Glob",
              input: { pattern: "*" },
            },
          ],
        },
      }),
    );

    expect(events).toEqual([
      {
        type: "tool-use",
        id: "toolu_1",
        name: "Glob",
        input: { pattern: "*" },
      },
    ]);
  });

  it("traduz resultados de ferramenta, com erro quando is_error é verdadeiro", () => {
    const events = toRunnerEvents(
      message({
        type: "user",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", is_error: true },
            { type: "tool_result", tool_use_id: "toolu_2" },
          ],
        },
      }),
    );

    expect(events).toEqual([
      { type: "tool-result", toolUseId: "toolu_1", isError: true },
      { type: "tool-result", toolUseId: "toolu_2", isError: false },
    ]);
  });

  it("marca o fim do turno com sucesso", () => {
    const events = toRunnerEvents(
      message({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "pronto",
      }),
    );

    expect(events).toEqual([{ type: "turn-end", ok: true, text: "pronto" }]);
  });

  it("marca o fim do turno como falha quando o subtipo é de erro", () => {
    const events = toRunnerEvents(
      message({ type: "result", subtype: "error_max_turns", is_error: true }),
    );

    expect(events).toEqual([
      {
        type: "turn-end",
        ok: false,
        text: "Turno interrompido: error_max_turns",
      },
    ]);
  });

  it("ignora tipos que a interface ainda não usa", () => {
    expect(
      toRunnerEvents(message({ type: "system", subtype: "status" })),
    ).toEqual([]);
  });
});

describe("buildOptions com modelo e esforço", () => {
  it("não envia modelo nem esforço quando o usuário deixou o padrão", () => {
    const options = buildOptions(turnInput());

    expect(options).not.toHaveProperty("model");
    expect(options).not.toHaveProperty("effort");
  });

  it("envia modelo e esforço escolhidos", () => {
    const options = buildOptions(turnInput({ model: "opus", effort: "high" }));

    expect(options.model).toBe("opus");
    expect(options.effort).toBe("high");
  });
});

describe("listClaudeModels", () => {
  it("converte a lista do SDK e descarta níveis de esforço desconhecidos", async () => {
    const close = vi.fn();
    const queryFn = (() => ({
      supportedModels: async () => [
        {
          value: "opus",
          displayName: "Opus 5.5",
          supportedEffortLevels: ["low", "turbo", "max"],
        },
        { value: "haiku", displayName: "Haiku 5.5" },
      ],
      close,
    })) as unknown as QueryFn;

    const models = await listClaudeModels(queryFn, { cwd, configDir });

    expect(models).toEqual([
      {
        value: "opus",
        displayName: "Opus 5.5",
        supportedEffortLevels: ["low", "max"],
      },
      { value: "haiku", displayName: "Haiku 5.5", supportedEffortLevels: [] },
    ]);
    expect(close).toHaveBeenCalled();
  });

  it("fecha a consulta mesmo quando a listagem falha", async () => {
    const close = vi.fn();
    const queryFn = (() => ({
      supportedModels: async () => {
        throw new Error("sem login");
      },
      close,
    })) as unknown as QueryFn;

    await expect(listClaudeModels(queryFn, { cwd, configDir })).rejects.toThrow(
      "sem login",
    );
    expect(close).toHaveBeenCalled();
  });
});

describe("runClaudeTurn", () => {
  it("emite a sessão uma vez e depois os eventos do turno", async () => {
    const events = await collect(
      turnInput(),
      fakeQuery([
        message({
          type: "stream_event",
          session_id: "abc-123",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "oi" },
          },
        }),
        message({
          type: "result",
          session_id: "abc-123",
          subtype: "success",
          is_error: false,
          result: "oi",
        }),
      ]),
    );

    expect(events).toEqual([
      { type: "session", sessionId: "abc-123" },
      { type: "text-delta", text: "oi" },
      { type: "turn-end", ok: true, text: "oi" },
    ]);
  });

  it("transforma erro do SDK em fim de turno com falha, sem engolir o motivo", async () => {
    const events = await collect(
      turnInput(),
      fakeQuery([], new Error("processo do Claude saiu com código 1")),
    );

    expect(events).toEqual([
      {
        type: "turn-end",
        ok: false,
        text: "processo do Claude saiu com código 1",
      },
    ]);
  });

  it("cancelamento pelo usuário não vira falha", async () => {
    const input = turnInput();
    input.abortController.abort();

    const events = await collect(
      input,
      fakeQuery([], new Error("operação cancelada")),
    );

    expect(events).toEqual([]);
  });

  it("passa o prompt e as opções para o SDK", async () => {
    const queryFn = vi.fn(fakeQuery([]));

    await collect(turnInput({ prompt: "teste", mode: "readonly" }), queryFn);

    expect(queryFn).toHaveBeenCalledWith({
      prompt: "teste",
      options: expect.objectContaining({ permissionMode: "dontAsk" }),
    });
  });
});
