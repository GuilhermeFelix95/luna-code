import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { IpcMain } from "electron";
import {
  CHAT_CHANNELS,
  isChatMode,
  isEffortLevel,
  type ChatEvent,
  type ChatEventPayload,
  type ChatModel,
  type ChatSettings,
  type RunnerEvent,
} from "./chat-api";
import { parseText } from "./terminal-validation";

export const MAX_CONVERSATION_ID_LENGTH = 64;
export const MAX_MODEL_LENGTH = 100;
export const MAX_REQUEST_ID_LENGTH = 64;

export interface TurnRequest {
  prompt: string;
  settings: ChatSettings;
  /** Sessão anterior da conversa, para o Claude continuar o mesmo histórico. */
  sessionId?: string;
  abortController: AbortController;
  /** Pergunta ao usuário quando o modo exige aprovação. */
  canUseTool: CanUseTool;
}

/** Roda um turno do Claude. Vem do processo principal, que escolhe a pasta e o perfil. */
export type StartTurn = (request: TurnRequest) => AsyncIterable<RunnerEvent>;

export type ListModels = () => Promise<ChatModel[]>;

export type SendToRenderer = (channel: string, payload: unknown) => void;

interface PendingApproval {
  conversationId: string;
  answer: (allowed: boolean) => void;
}

export function registerChatIpc(
  ipc: IpcMain,
  startTurn: StartTurn,
  listModels: ListModels,
  sendToRenderer: SendToRenderer,
): void {
  // Sessão do Claude de cada conversa, para os próximos turnos continuarem nela.
  const sessions = new Map<string, string>();
  // Turnos em andamento. Uma conversa tem no máximo um turno por vez.
  const running = new Map<string, AbortController>();
  // Aprovações esperando resposta do usuário, por id do pedido.
  const approvals = new Map<string, PendingApproval>();
  let approvalSequence = 0;

  function emit(conversationId: string, event: ChatEvent): void {
    const payload: ChatEventPayload = { conversationId, event };
    sendToRenderer(CHAT_CHANNELS.event, payload);
  }

  /** Cria o pedido de aprovação de uma conversa; o SDK espera a resposta antes de seguir. */
  function askApproval(conversationId: string): CanUseTool {
    return (toolName, input, { signal }) =>
      new Promise<PermissionResult>((resolve) => {
        approvalSequence += 1;
        const requestId = `aprovacao-${approvalSequence}`;
        const answer = (allowed: boolean): void => {
          approvals.delete(requestId);
          resolve(
            allowed
              ? { behavior: "allow", updatedInput: input }
              : { behavior: "deny", message: "O usuário negou esta ação." },
          );
        };
        approvals.set(requestId, { conversationId, answer });
        // Parar a resposta nega as aprovações que ainda estão abertas.
        signal.addEventListener("abort", () => answer(false), { once: true });
        emit(conversationId, {
          type: "approval-request",
          requestId,
          toolName,
          input,
        });
      });
  }

  async function relay(
    conversationId: string,
    prompt: string,
    settings: ChatSettings,
    controller: AbortController,
  ): Promise<void> {
    let finished = false;
    try {
      const turn = startTurn({
        prompt,
        settings,
        sessionId: sessions.get(conversationId),
        abortController: controller,
        canUseTool: askApproval(conversationId),
      });
      for await (const event of turn) {
        if (event.type === "session") {
          sessions.set(conversationId, event.sessionId);
        }
        if (event.type === "turn-end") {
          finished = true;
        }
        emit(conversationId, event);
      }
    } catch (error: unknown) {
      console.error("Falha no turno do chat:", error);
      finished = true;
      emit(conversationId, {
        type: "turn-end",
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running.delete(conversationId);
    }

    // Cancelado antes de o SDK emitir o fim do turno: a interface precisa saber que acabou.
    if (!finished) {
      emit(conversationId, {
        type: "turn-end",
        ok: false,
        text: "Resposta interrompida.",
      });
    }
  }

  ipc.handle(
    CHAT_CHANNELS.send,
    (_event, conversationId: unknown, text: unknown, settings: unknown) => {
      const id = parseConversationId(conversationId);
      const prompt = parsePrompt(text);
      const parsedSettings = parseSettings(settings);
      if (running.has(id)) {
        throw new Error("ainda há uma resposta em andamento nesta conversa");
      }

      const controller = new AbortController();
      running.set(id, controller);
      // O turno roda em segundo plano; os eventos chegam pelo canal de eventos.
      void relay(id, prompt, parsedSettings, controller);
    },
  );

  ipc.handle(CHAT_CHANNELS.stop, (_event, conversationId: unknown) => {
    const id = parseConversationId(conversationId);
    running.get(id)?.abort();
  });

  ipc.handle(
    CHAT_CHANNELS.approve,
    (_event, requestId: unknown, allowed: unknown) => {
      const id = parseRequestId(requestId);
      if (typeof allowed !== "boolean") {
        throw new Error("a resposta da aprovação deve ser verdadeira ou falsa");
      }
      const pending = approvals.get(id);
      if (!pending) {
        throw new Error("aprovação desconhecida ou já respondida");
      }
      pending.answer(allowed);
    },
  );

  ipc.handle(CHAT_CHANNELS.models, () => listModels());
}

function parseConversationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CONVERSATION_ID_LENGTH
  ) {
    throw new Error(
      `conversationId deve ser texto de 1 a ${MAX_CONVERSATION_ID_LENGTH} caracteres`,
    );
  }
  return value;
}

function parseRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REQUEST_ID_LENGTH
  ) {
    throw new Error(
      `requestId deve ser texto de 1 a ${MAX_REQUEST_ID_LENGTH} caracteres`,
    );
  }
  return value;
}

function parsePrompt(value: unknown): string {
  const text = parseText(value).trim();
  if (text.length === 0) {
    throw new Error("a mensagem não pode estar vazia");
  }
  return text;
}

/** Valida o que veio do renderer. Modelo e esforço ausentes significam padrão. */
function parseSettings(value: unknown): ChatSettings {
  if (typeof value !== "object" || value === null) {
    throw new Error("configuração do envio deve ser um objeto");
  }
  const { mode, model, effort } = value as Record<string, unknown>;
  if (!isChatMode(mode)) {
    throw new Error(`modo de permissão desconhecido: ${String(mode)}`);
  }

  const settings: ChatSettings = { mode };
  if (model !== undefined) {
    if (
      typeof model !== "string" ||
      model.length === 0 ||
      model.length > MAX_MODEL_LENGTH
    ) {
      throw new Error(
        `modelo deve ser texto de 1 a ${MAX_MODEL_LENGTH} caracteres`,
      );
    }
    settings.model = model;
  }
  if (effort !== undefined) {
    if (!isEffortLevel(effort)) {
      throw new Error(`nível de esforço desconhecido: ${String(effort)}`);
    }
    settings.effort = effort;
  }
  return settings;
}
