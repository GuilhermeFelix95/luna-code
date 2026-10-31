// Estado de uma conversa do chat. Funções puras sobre o objeto, sem DOM, para testar em Node.

import type { ChatEvent, ChatSettings } from "../src/chat-api";

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
  title: string;
  messages: Message[];
  /** Verdadeiro entre o envio e o fim do turno. */
  busy: boolean;
  /** Modo, modelo e esforço desta conversa. Valem para a próxima mensagem. */
  settings: ChatSettings;
  /** Sessão do Claude, para continuar o histórico. Vem no primeiro evento do turno. */
  sessionId?: string;
}

export function newConversation(
  id: string,
  settings: ChatSettings,
): Conversation {
  return {
    id,
    title: "Nova conversa",
    messages: [],
    busy: false,
    settings: { ...settings },
  };
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
