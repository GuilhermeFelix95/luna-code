// Executa um turno do Claude Code pelo Agent SDK e traduz as mensagens em eventos do app.
// O Claude roda por baixo, mas a conversa é desenhada pela interface do app, não pela TUI.

import type {
  CanUseTool,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  isEffortLevel,
  type ChatMode,
  type ChatModel,
  type EffortLevel,
  type RunnerEvent,
} from "./chat-api";
import { sidecarEnv } from "./sidecar-env";

export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: Options;
}) => Query;

export interface TurnInput {
  prompt: string;
  mode: ChatMode;
  /** Alias do modelo (ex.: "opus"). Ausente usa o padrão do modelo. */
  model?: string;
  /** Ausente usa o padrão do modelo. */
  effort?: EffortLevel;
  /** Planejar: sobrepõe o modo escolhido. */
  planning?: boolean;
  /** Sessão anterior do Claude, para continuar a mesma conversa. */
  sessionId?: string;
  /** Pasta de trabalho do app (fora da pasta pessoal, como no terminal). */
  cwd: string;
  /** Perfil isolado do Claude, onde fica o login. */
  configDir: string;
  /** Usado nos modos que pedem aprovação. */
  canUseTool: CanUseTool;
  abortController: AbortController;
}

/**
 * Planejar: o SDK só explora e propõe; edições e comandos não rodam. Qualquer pedido de
 * ferramenta que mesmo assim chegar é negado, sem perguntar.
 */
const PLANNING_OPTIONS: Partial<Options> = {
  permissionMode: "plan",
  canUseTool: async () => ({
    behavior: "deny",
    message: "Planejamento: nada é executado nesta conversa.",
  }),
};

/** Opções do SDK que cada modo acrescenta às opções comuns. */
const MODE_OPTIONS: Record<
  ChatMode,
  (canUseTool: CanUseTool) => Partial<Options>
> = {
  // Só leitura: o que não exige aprovação roda (inclusive comandos somente leitura),
  // e qualquer outra chamada é negada sem perguntar. Edit e Write nunca rodam.
  readonly: () => ({
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Edit", "Write", "NotebookEdit"],
  }),
  ask: (canUseTool) => ({ permissionMode: "default", canUseTool }),
  full: (canUseTool) => ({
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    canUseTool,
  }),
};

/** Opções de perfil comuns a turnos e à consulta de modelos: pasta, login e ambiente limpo. */
export function profileOptions(
  cwd: string,
  configDir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Options {
  return {
    cwd,
    env: { ...sidecarEnv(parentEnv), CLAUDE_CONFIG_DIR: configDir },
  };
}

export function buildOptions(
  input: TurnInput,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Options {
  return {
    ...profileOptions(input.cwd, input.configDir, parentEnv),
    resume: input.sessionId,
    includePartialMessages: true,
    abortController: input.abortController,
    // Só entram quando definidos: o SDK usa o padrão do modelo se não receber nada.
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    ...(input.planning
      ? PLANNING_OPTIONS
      : MODE_OPTIONS[input.mode](input.canUseTool)),
  };
}

/** Entrada que nunca envia mensagem. Mantém a consulta aberta até ela ser fechada. */
async function* idlePrompt(): AsyncGenerator<never> {
  await new Promise<void>(() => undefined);
  yield* [];
}

/** Lista os modelos da conta, com os níveis de esforço que cada um aceita. */
export async function listClaudeModels(
  queryFn: QueryFn,
  profile: { cwd: string; configDir: string },
): Promise<ChatModel[]> {
  const run = queryFn({
    prompt: idlePrompt(),
    options: profileOptions(profile.cwd, profile.configDir),
  });
  try {
    const models = await run.supportedModels();
    return models.map((model) => ({
      value: model.value,
      displayName: model.displayName,
      supportedEffortLevels: (model.supportedEffortLevels ?? []).filter(
        isEffortLevel,
      ),
    }));
  } finally {
    run.close();
  }
}

/** Converte uma mensagem do SDK em zero ou mais eventos. Mensagens de subagentes são ignoradas. */
export function toRunnerEvents(message: SDKMessage): RunnerEvent[] {
  switch (message.type) {
    case "stream_event": {
      if (message.parent_tool_use_id !== null) {
        return [];
      }
      const event = message.event;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        return [{ type: "text-delta", text: event.delta.text }];
      }
      return [];
    }

    case "assistant": {
      if (message.parent_tool_use_id !== null) {
        return [];
      }
      return message.message.content.flatMap((block) =>
        block.type === "tool_use"
          ? [
              {
                type: "tool-use" as const,
                id: block.id,
                name: block.name,
                input: block.input,
              },
            ]
          : [],
      );
    }

    case "user": {
      if (
        message.parent_tool_use_id !== null ||
        typeof message.message.content === "string"
      ) {
        return [];
      }
      return message.message.content.flatMap((block) =>
        block.type === "tool_result"
          ? [
              {
                type: "tool-result" as const,
                toolUseId: block.tool_use_id,
                isError: block.is_error ?? false,
              },
            ]
          : [],
      );
    }

    case "result": {
      if (message.subtype === "success") {
        return [
          { type: "turn-end", ok: !message.is_error, text: message.result },
        ];
      }
      return [
        {
          type: "turn-end",
          ok: false,
          text: `Turno interrompido: ${message.subtype}`,
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Roda um turno e emite os eventos conforme chegam. Erros do SDK viram um
 * `turn-end` com `ok: false`, para a interface mostrar o motivo.
 */
export async function* runClaudeTurn(
  input: TurnInput,
  queryFn: QueryFn,
): AsyncGenerator<RunnerEvent> {
  const options = buildOptions(input);
  const run = queryFn({ prompt: input.prompt, options });
  let sessionSent = false;

  try {
    for await (const message of run) {
      if (
        !sessionSent &&
        "session_id" in message &&
        typeof message.session_id === "string"
      ) {
        sessionSent = true;
        yield { type: "session", sessionId: message.session_id };
      }
      yield* toRunnerEvents(message);
    }
  } catch (error) {
    // Cancelado pelo usuário: o SDK lança erro ao abortar, e isso não é falha.
    if (input.abortController.signal.aborted) {
      return;
    }
    const text = error instanceof Error ? error.message : String(error);
    yield { type: "turn-end", ok: false, text };
  }
}
