// Converte o histórico que o SDK grava em disco nas mensagens que a interface mostra.

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { HistoryMessage } from "./chat-api";

/** Só mensagens com texto viram balão. Resultados de ferramenta e mensagens de sistema ficam de fora. */
export function toHistoryMessages(
  messages: SessionMessage[],
): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  for (const item of messages) {
    if (item.type !== "user" && item.type !== "assistant") {
      continue;
    }
    if (item.parent_tool_use_id !== null) {
      continue;
    }
    const text = textOf(item.message);
    if (text.length > 0) {
      history.push({ role: item.type, text });
    }
  }
  return history;
}

/** Junta os blocos de texto de uma mensagem. Conteúdo que não é texto é ignorado. */
function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((block: unknown) => {
      const { type, text } = (block ?? {}) as {
        type?: unknown;
        text?: unknown;
      };
      return type === "text" && typeof text === "string" ? [text] : [];
    })
    .join("\n")
    .trim();
}
