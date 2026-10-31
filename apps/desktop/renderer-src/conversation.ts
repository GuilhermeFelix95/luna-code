// Estado de uma conversa do chat. Funções puras sobre o objeto, sem DOM, para testar em Node.

import type { ChatEvent, ChatSettings, HistoryMessage } from "../src/chat-api";
import type { ConversationRecord } from "../src/state-api";

export const DEFAULT_TITLE = "Nova conversa";
export const TITLE_MAX_CHARS = 40;

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
}

export type ApprovalStatus = "pending" | "allowed" | "denied";

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; tools: ToolCall[] }
  | { role: "error"; text: string }
  | {
      role: "approval";
      requestId: string;
      toolName: string;
      input: unknown;
      status: ApprovalStatus;
    };

export interface Conversation {
  id: string;
  /** Projeto dono da conversa. A pasta de trabalho é a dele. */
  projectId: string;
  title: string;
  messages: Message[];
  /** Verdadeiro entre o envio e o fim do turno. */
  busy: boolean;
  /** Modo, modelo, esforço e planejar desta conversa. Valem para a próxima mensagem. */
  settings: ChatSettings;
  /** Sessão do Claude, para continuar o histórico. Vem no primeiro evento do turno ou do disco. */
  sessionId?: string;
  /** Falso enquanto o histórico de uma conversa salva não foi carregado. */
  historyLoaded: boolean;
}

export function newConversation(
  id: string,
  projectId: string,
  settings: ChatSettings,
  title = DEFAULT_TITLE,
): Conversation {
  return {
    id,
    projectId,
    title,
    messages: [],
    busy: false,
    settings: { ...settings },
    historyLoaded: true,
  };
}

/** Conversa salva: o histórico só é lido quando ela é aberta. */
export function conversationFromRecord(
  record: ConversationRecord,
): Conversation {
  return {
    ...newConversation(
      record.id,
      record.projectId,
      record.settings,
      record.title,
    ),
    sessionId: record.sessionId,
    historyLoaded: record.sessionId === undefined,
  };
}

/** Preenche a conversa com o histórico lido do Claude. Substitui o que houver na tela. */
export function setHistory(
  conversation: Conversation,
  history: HistoryMessage[],
): void {
  conversation.messages = history.map((item): Message =>
    item.role === "user"
      ? { role: "user", text: item.text }
      : { role: "assistant", text: item.text, tools: [] },
  );
  conversation.historyLoaded = true;
}

export function addUserMessage(conversation: Conversation, text: string): void {
  if (conversation.messages.length === 0) {
    conversation.title = shorten(text);
  }
  conversation.messages.push({ role: "user", text });
  conversation.busy = true;
}

export function applyEvent(conversation: Conversation, event: ChatEvent): void {
  switch (event.type) {
    case "session":
      conversation.sessionId = event.sessionId;
      return;

    case "text-delta":
      assistantMessage(conversation).text += event.text;
      return;

    case "tool-use":
      assistantMessage(conversation).tools.push({
        id: event.id,
        name: event.name,
        input: event.input,
        status: "running",
      });
      return;

    case "tool-result": {
      const tool = findTool(conversation, event.toolUseId);
      if (tool) {
        tool.status = event.isError ? "error" : "done";
      }
      return;
    }

    case "approval-request":
      conversation.messages.push({
        role: "approval",
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
        status: "pending",
      });
      return;

    case "turn-end":
      conversation.busy = false;
      // Aprovações ainda abertas quando o turno termina foram negadas (parar a resposta).
      for (const message of conversation.messages) {
        if (message.role === "approval" && message.status === "pending") {
          message.status = "denied";
        }
      }
      if (!event.ok) {
        conversation.messages.push({ role: "error", text: event.text });
      }
      return;
  }
}

/** Marca a resposta do usuário a um pedido de aprovação. */
export function resolveApproval(
  conversation: Conversation,
  requestId: string,
  allowed: boolean,
): void {
  for (const message of conversation.messages) {
    if (message.role === "approval" && message.requestId === requestId) {
      message.status = allowed ? "allowed" : "denied";
    }
  }
}

/** Devolve a última mensagem do assistente, criando uma se o turno acabou de começar. */
function assistantMessage(
  conversation: Conversation,
): Extract<Message, { role: "assistant" }> {
  const last = conversation.messages.at(-1);
  if (last?.role === "assistant") {
    return last;
  }
  const created = { role: "assistant" as const, text: "", tools: [] };
  conversation.messages.push(created);
  return created;
}

function findTool(
  conversation: Conversation,
  id: string,
): ToolCall | undefined {
  for (const message of conversation.messages) {
    if (message.role === "assistant") {
      const tool = message.tools.find((candidate) => candidate.id === id);
      if (tool) {
        return tool;
      }
    }
  }
  return undefined;
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_CHARS
    ? `${oneLine.slice(0, TITLE_MAX_CHARS - 1)}…`
    : oneLine;
}
