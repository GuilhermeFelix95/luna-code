import { describe, expect, it } from "vitest";
import type { ConversationRecord } from "../src/state-api";
import {
  conversationFromRecord,
  setHistory,
  type Conversation,
} from "./conversation";

function record(
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id: "conversa-1",
    title: "Revisar o parser",
    projectId: "projeto-1",
    settings: { mode: "ask", planning: true },
    hidden: false,
    ...overrides,
  };
}

describe("conversationFromRecord", () => {
  it("conversa sem sessão não tem histórico a carregar", () => {
    const conversation = conversationFromRecord(record());

    expect(conversation).toMatchObject({
      id: "conversa-1",
      projectId: "projeto-1",
      title: "Revisar o parser",
      settings: { mode: "ask", planning: true },
      historyLoaded: true,
    });
  });

  it("conversa com sessão salva espera o histórico ser lido", () => {
    const conversation = conversationFromRecord(
      record({ sessionId: "sessao-9" }),
    );

    expect(conversation.sessionId).toBe("sessao-9");
    expect(conversation.historyLoaded).toBe(false);
  });

  it("não compartilha o objeto de configurações com o registro", () => {
    const source = record();
    const conversation = conversationFromRecord(source);

    conversation.settings.mode = "full";

    expect(source.settings.mode).toBe("ask");
  });
});

describe("setHistory", () => {
  it("troca o conteúdo pelas mensagens lidas, mantendo a ordem", () => {
    const conversation: Conversation = conversationFromRecord(
      record({ sessionId: "sessao-9" }),
    );

    setHistory(conversation, [
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá" },
    ]);

    expect(conversation.messages).toEqual([
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá", tools: [] },
    ]);
    expect(conversation.historyLoaded).toBe(true);
  });
});
