import type { IpcMain } from "electron";
import {
  CHAT_CHANNELS,
  type ChatEventPayload,
  type RunnerEvent,
} from "./chat-api";
import { parseText } from "./terminal-validation";

export const MAX_CONVERSATION_ID_LENGTH = 64;

export interface TurnRequest {
  prompt: string;
  /** Sessão anterior da conversa, para o Claude continuar o mesmo histórico. */
  sessionId?: string;
  abortController: AbortController;
}

/** Roda um turno do Claude. Vem do processo principal, que escolhe modo e pasta. */
export type StartTurn = (request: TurnRequest) => AsyncIterable<RunnerEvent>;

export type SendToRenderer = (channel: string, payload: unknown) => void;

export function registerChatIpc(
  ipc: IpcMain,
  startTurn: StartTurn,
  sendToRenderer: SendToRenderer,
): void {
  // Sessão do Claude de cada conversa, para os próximos turnos continuarem nela.
  const sessions = new Map<string, string>();
  // Turnos em andamento. Uma conversa tem no máximo um turno por vez.
  const running = new Map<string, AbortController>();

  function emit(conversationId: string, event: RunnerEvent): void {
    const payload: ChatEventPayload = { conversationId, event };
    sendToRenderer(CHAT_CHANNELS.event, payload);
  }

  async function relay(
    conversationId: string,
    prompt: string,
    controller: AbortController,
  ): Promise<void> {
    let finished = false;
    try {
      const turn = startTurn({
        prompt,
        sessionId: sessions.get(conversationId),
        abortController: controller,
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
    (_event, conversationId: unknown, text: unknown) => {
      const id = parseConversationId(conversationId);
      const prompt = parsePrompt(text);
      if (running.has(id)) {
        throw new Error("ainda há uma resposta em andamento nesta conversa");
      }

      const controller = new AbortController();
      running.set(id, controller);
      // O turno roda em segundo plano; os eventos chegam pelo canal de eventos.
      void relay(id, prompt, controller);
    },
  );

  ipc.handle(CHAT_CHANNELS.stop, (_event, conversationId: unknown) => {
    const id = parseConversationId(conversationId);
    running.get(id)?.abort();
  });
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

function parsePrompt(value: unknown): string {
  const text = parseText(value).trim();
  if (text.length === 0) {
    throw new Error("a mensagem não pode estar vazia");
  }
  return text;
}
