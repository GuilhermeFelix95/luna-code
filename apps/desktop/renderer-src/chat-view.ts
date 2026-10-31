// Tela de conversa com o Claude. O Claude roda por baixo; o usuário vê só mensagens e cartões.
// Todo texto vai por textContent, nunca por innerHTML: a saída do modelo não é HTML confiável.

import type { ChatBridge } from "../src/chat-api";
import {
  addUserMessage,
  applyEvent,
  newConversation,
  type Conversation,
  type Message,
  type ToolCall,
} from "./conversation";

export interface ChatViewElements {
  /** Área onde a conversa e o campo de envio são desenhados. */
  host: HTMLElement;
  /** Lista de conversas na barra lateral. */
  list: HTMLUListElement;
}

export class ChatView {
  private readonly conversations: Conversation[] = [];
  private current: Conversation | undefined;
  private sequence = 0;
  private readonly messages: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;

  constructor(
    private readonly elements: ChatViewElements,
    private readonly bridge: ChatBridge,
    private readonly onActivate: () => void,
  ) {
    this.messages = document.createElement("div");
    this.messages.className = "chat-messages";

    this.input = document.createElement("textarea");
    this.input.rows = 1;
    this.input.placeholder = "Escreva para o Claude";
    this.input.setAttribute("aria-label", "Mensagem");

    this.sendButton = document.createElement("button");
    this.sendButton.type = "submit";
    this.sendButton.className = "chat-send";
    this.sendButton.textContent = "Enviar";

    this.elements.host.append(this.messages, this.buildComposer());

    bridge.onEvent(({ conversationId, event }) => {
      const conversation = this.conversations.find(
        (candidate) => candidate.id === conversationId,
      );
      if (!conversation) {
        return;
      }
      applyEvent(conversation, event);
      this.renderList();
      if (conversation === this.current) {
        this.renderMessages();
      }
    });

    this.renderList();
    this.renderMessages();
  }

  /** Abre uma conversa vazia e a deixa ativa. */
  newConversation(): void {
    this.sequence += 1;
    const conversation = newConversation(`conversa-${this.sequence}`);
    this.conversations.push(conversation);
    this.select(conversation);
  }

  private select(conversation: Conversation): void {
    this.current = conversation;
    this.onActivate();
    this.elements.host.hidden = false;
    this.renderList();
    this.renderMessages();
    this.input.focus();
  }

  private buildComposer(): HTMLFormElement {
    const form = document.createElement("form");
    form.className = "chat-composer";

    const footer = document.createElement("div");
    footer.className = "chat-composer-footer";
    const mode = document.createElement("span");
    mode.textContent = "Somente leitura";
    footer.append(mode, this.sendButton);

    form.append(this.input, footer);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send();
    });
    this.input.addEventListener("keydown", (event) => {
      // Enter só envia; parar a resposta fica no botão, para não cancelar sem querer.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!this.current?.busy) {
          this.send();
        }
      }
    });
    return form;
  }

  /** Envia a mensagem, ou para a resposta em andamento quando o botão está em "Parar". */
  private send(): void {
    if (this.current?.busy) {
      void this.bridge.stop(this.current.id);
      return;
    }
    const text = this.input.value.trim();
    if (text.length === 0) {
      return;
    }
    if (!this.current) {
      this.newConversation();
    }
    const conversation = this.current;
    if (!conversation) {
      return;
    }

    this.input.value = "";
    addUserMessage(conversation, text);
    this.renderList();
    this.renderMessages();

    this.bridge.send(conversation.id, text).catch((error: unknown) => {
      // Falha ao enviar (por exemplo, mensagem vazia recusada pelo processo principal).
      console.error("Falha ao enviar mensagem:", error);
      conversation.busy = false;
      conversation.messages.push({ role: "error", text: String(error) });
      this.renderMessages();
    });
  }

  private renderList(): void {
    this.elements.list.replaceChildren(
      ...this.conversations.map((conversation) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-item";
        button.textContent = conversation.title;
        if (conversation === this.current) {
          button.setAttribute("aria-current", "true");
        }
        button.addEventListener("click", () => this.select(conversation));
        item.append(button);
        return item;
      }),
    );
  }

  private renderMessages(): void {
    const conversation = this.current;
    this.sendButton.textContent = conversation?.busy ? "Parar" : "Enviar";
    this.messages.replaceChildren(
      ...(conversation?.messages ?? []).map((message) =>
        renderMessage(message),
      ),
    );
    if (conversation?.busy) {
      this.messages.append(thinking());
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }
}

function renderMessage(message: Message): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `message message-${message.role}`;

  const text = document.createElement("p");
  text.textContent = message.text;
  wrapper.append(text);

  if (message.role === "assistant") {
    wrapper.append(...message.tools.map(renderTool));
  }
  return wrapper;
}

function renderTool(tool: ToolCall): HTMLElement {
  const details = document.createElement("details");
  details.className = `tool tool-${tool.status}`;

  const summary = document.createElement("summary");
  summary.textContent = `${tool.name} · ${STATUS_LABEL[tool.status]}`;

  const input = document.createElement("pre");
  input.textContent = JSON.stringify(tool.input, null, 2);

  details.append(summary, input);
  return details;
}

const STATUS_LABEL: Record<ToolCall["status"], string> = {
  running: "executando",
  done: "concluído",
  error: "erro",
};

function thinking(): HTMLElement {
  const element = document.createElement("p");
  element.className = "thinking";
  element.textContent = "Pensando…";
  return element;
}
