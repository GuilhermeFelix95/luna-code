import { describe, expect, it } from "vitest";
import {
  addUserMessage,
  applyEvent,
  newConversation,
  resolveApproval,
  TITLE_MAX_CHARS,
} from "./conversation";

describe("conversation", () => {
  it("usa a primeira mensagem como título, encurtada", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    const longText = "x".repeat(TITLE_MAX_CHARS + 10);

    addUserMessage(conversation, longText);

    expect(conversation.title).toHaveLength(TITLE_MAX_CHARS);
    expect(conversation.title.endsWith("…")).toBe(true);
    expect(conversation.busy).toBe(true);
  });

  it("junta os deltas de texto numa única mensagem do assistente", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    addUserMessage(conversation, "oi");

    applyEvent(conversation, { type: "text-delta", text: "Olá" });
    applyEvent(conversation, { type: "text-delta", text: ", tudo bem?" });

    expect(conversation.messages).toEqual([
      { role: "user", text: "oi" },
      { role: "assistant", text: "Olá, tudo bem?", tools: [] },
    ]);
  });

  it("registra ferramenta e marca o resultado", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    addUserMessage(conversation, "liste");

    applyEvent(conversation, {
      type: "tool-use",
      id: "t1",
      name: "Glob",
      input: { pattern: "*" },
    });
    applyEvent(conversation, {
      type: "tool-result",
      toolUseId: "t1",
      isError: false,
    });

    expect(conversation.messages[1]).toEqual({
      role: "assistant",
      text: "",
      tools: [
        { id: "t1", name: "Glob", input: { pattern: "*" }, status: "done" },
      ],
    });
  });

  it("marca ferramenta com erro quando o resultado vem com is_error", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    addUserMessage(conversation, "leia");
    applyEvent(conversation, {
      type: "tool-use",
      id: "t1",
      name: "Read",
      input: {},
    });

    applyEvent(conversation, {
      type: "tool-result",
      toolUseId: "t1",
      isError: true,
    });

    const message = conversation.messages[1];
    expect(message.role === "assistant" && message.tools[0].status).toBe(
      "error",
    );
  });

  it("guarda a sessão e encerra o envio no fim do turno", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    addUserMessage(conversation, "oi");

    applyEvent(conversation, { type: "session", sessionId: "s-1" });
    applyEvent(conversation, { type: "turn-end", ok: true, text: "oi" });

    expect(conversation.sessionId).toBe("s-1");
    expect(conversation.busy).toBe(false);
  });

  it("falha do turno vira mensagem de erro, sem sumir", () => {
    const conversation = newConversation("c1", { mode: "readonly" });
    addUserMessage(conversation, "oi");

    applyEvent(conversation, {
      type: "turn-end",
      ok: false,
      text: "sem login",
    });

    expect(conversation.messages.at(-1)).toEqual({
      role: "error",
      text: "sem login",
    });
    expect(conversation.busy).toBe(false);
  });

  it("copia as configurações da conversa, sem compartilhar o objeto", () => {
    const settings = { mode: "ask" as const, model: "opus" };
    const conversation = newConversation("c1", settings);

    conversation.settings.model = "haiku";

    expect(settings.model).toBe("opus");
  });

  it("pedido de aprovação fica pendente até ser respondido", () => {
    const conversation = newConversation("c1", { mode: "ask" });
    addUserMessage(conversation, "crie um arquivo");

    applyEvent(conversation, {
      type: "approval-request",
      requestId: "aprovacao-1",
      toolName: "Write",
      input: { file_path: "a.txt" },
    });
    expect(conversation.messages.at(-1)).toEqual({
      role: "approval",
      requestId: "aprovacao-1",
      toolName: "Write",
      input: { file_path: "a.txt" },
      status: "pending",
    });

    resolveApproval(conversation, "aprovacao-1", true);
    expect(conversation.messages.at(-1)).toMatchObject({ status: "allowed" });
  });

  it("fim do turno nega aprovações que ainda estavam abertas", () => {
    const conversation = newConversation("c1", { mode: "ask" });
    addUserMessage(conversation, "crie um arquivo");
    applyEvent(conversation, {
      type: "approval-request",
      requestId: "aprovacao-1",
      toolName: "Write",
      input: {},
    });

    applyEvent(conversation, {
      type: "turn-end",
      ok: false,
      text: "Resposta interrompida.",
    });

    expect(conversation.messages[1]).toMatchObject({ status: "denied" });
  });
});
