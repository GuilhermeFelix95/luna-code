// Tela de conversa com o Claude. O Claude roda por baixo; o usuário vê só mensagens e cartões.
// Todo texto vai por textContent, nunca por innerHTML: a saída do modelo não é HTML confiável.

import {
  CHAT_MODES,
  type ChatBridge,
  type ChatMode,
  type ChatModel,
  type ChatSettings,
  type EffortLevel,
} from "../src/chat-api";
import {
  addUserMessage,
  applyEvent,
  newConversation,
  resolveApproval,
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

const MODE_LABEL: Record<ChatMode, string> = {
  readonly: "Somente leitura",
  ask: "Acesso parcial",
  full: "Acesso total",
};

const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

/** Valor do seletor que significa "padrão do modelo" (nada é enviado). */
const DEFAULT_OPTION = "";

export class ChatView {
  private readonly conversations: Conversation[] = [];
  private current: Conversation | undefined;
  private sequence = 0;
  /** Última escolha de modo, modelo e esforço. Conversas novas começam com ela. */
  private lastSettings: ChatSettings = { mode: "readonly" };
  private models: ChatModel[] = [];
  private modelsFailed = false;
  private readonly messages: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly effortSelect: HTMLSelectElement;

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

    this.modeSelect = createSelect("Modo de permissão");
    this.modelSelect = createSelect("Modelo");
    this.effortSelect = createSelect("Esforço");
    this.fillModeOptions();

    this.elements.host.append(this.messages, this.buildComposer());
    this.bindSelectors();

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
        this.renderFooter();
      }
    });

    this.loadModels();
    this.renderList();
    this.renderMessages();
    this.renderFooter();
  }

  /** Abre uma conversa vazia com a última escolha de modo, modelo e esforço. */
  newConversation(): void {
    this.sequence += 1;
    const conversation = newConversation(
      `conversa-${this.sequence}`,
      this.lastSettings,
    );
    this.conversations.push(conversation);
    this.select(conversation);
  }

  private select(conversation: Conversation): void {
    this.current = conversation;
    this.onActivate();
    this.elements.host.hidden = false;
    this.renderList();
    this.renderMessages();
    this.renderFooter();
    this.input.focus();
  }

  private buildComposer(): HTMLFormElement {
    const form = document.createElement("form");
    form.className = "chat-composer";

    const footer = document.createElement("div");
    footer.className = "chat-composer-footer";
    const selectors = document.createElement("div");
    selectors.className = "chat-selectors";
    selectors.append(this.modeSelect, this.modelSelect, this.effortSelect);
    footer.append(selectors, this.sendButton);

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

  private bindSelectors(): void {
    this.modeSelect.addEventListener("change", () => {
      this.updateSettings({ mode: this.modeSelect.value as ChatMode });
    });
    this.modelSelect.addEventListener("change", () => {
      const model =
        this.modelSelect.value === DEFAULT_OPTION
          ? undefined
          : this.modelSelect.value;
      // Um nível de esforço que o novo modelo não aceita volta ao padrão.
      const effort = this.levelsFor(model).includes(
        this.lastSettings.effort as EffortLevel,
      )
        ? this.lastSettings.effort
        : undefined;
      this.updateSettings({ model, effort });
    });
    this.effortSelect.addEventListener("change", () => {
      const effort =
        this.effortSelect.value === DEFAULT_OPTION
          ? undefined
          : (this.effortSelect.value as EffortLevel);
      this.updateSettings({ effort });
    });
  }

  /** Grava a escolha na conversa atual e como padrão para as próximas. */
  private updateSettings(change: Partial<ChatSettings>): void {
    this.lastSettings = withoutUnset({ ...this.lastSettings, ...change });
    if (this.current) {
      this.current.settings = withoutUnset({
        ...this.current.settings,
        ...change,
      });
    }
    this.renderFooter();
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
    this.renderFooter();

    this.bridge
      .send(conversation.id, text, withoutUnset(conversation.settings))
      .catch((error: unknown) => {
        // Falha ao enviar (por exemplo, configuração recusada pelo processo principal).
        console.error("Falha ao enviar mensagem:", error);
        conversation.busy = false;
        conversation.messages.push({ role: "error", text: String(error) });
        this.renderMessages();
        this.renderFooter();
      });
  }

  private answer(
    conversation: Conversation,
    requestId: string,
    allowed: boolean,
  ): void {
    this.bridge.approve(requestId, allowed).then(
      () => {
        resolveApproval(conversation, requestId, allowed);
        this.renderMessages();
      },
      (error: unknown) => {
        console.error("Falha ao responder aprovação:", error);
        conversation.messages.push({ role: "error", text: String(error) });
        this.renderMessages();
      },
    );
  }

  private loadModels(): void {
    this.bridge.listModels().then(
      (models) => {
        this.models = models;
        this.fillModelOptions();
        this.renderFooter();
      },
      (error: unknown) => {
        console.error("Falha ao listar modelos:", error);
        this.modelsFailed = true;
        this.fillModelOptions();
        this.renderFooter();
      },
    );
  }

  private fillModeOptions(): void {
    this.modeSelect.replaceChildren(
      ...CHAT_MODES.map((mode) => option(mode, MODE_LABEL[mode])),
    );
  }

  private fillModelOptions(): void {
    if (this.modelsFailed) {
      this.modelSelect.replaceChildren(
        option(DEFAULT_OPTION, "Modelos indisponíveis"),
      );
      return;
    }
    this.modelSelect.replaceChildren(
      option(DEFAULT_OPTION, "Padrão do modelo"),
      ...this.models.map((model) => option(model.value, model.displayName)),
    );
  }

  /** Níveis de esforço aceitos pelo modelo. Sem modelo escolhido, vale o padrão da conta. */
  private levelsFor(model: string | undefined): EffortLevel[] {
    const value = model ?? "default";
    return (
      this.models.find((candidate) => candidate.value === value)
        ?.supportedEffortLevels ?? []
    );
  }

  private renderFooter(): void {
    const conversation = this.current;
    const settings = conversation?.settings ?? this.lastSettings;
    const locked = !conversation || conversation.busy;

    this.modeSelect.value = settings.mode;
    this.modelSelect.value = settings.model ?? DEFAULT_OPTION;
    this.effortSelect.replaceChildren(
      option(DEFAULT_OPTION, "Padrão do modelo"),
      ...this.levelsFor(settings.model).map((level) =>
        option(level, EFFORT_LABEL[level]),
      ),
    );
    this.effortSelect.value = settings.effort ?? DEFAULT_OPTION;

    this.modeSelect.disabled = locked;
    this.modelSelect.disabled = locked || this.modelsFailed;
    this.effortSelect.disabled = locked;
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
        renderMessage(message, (requestId, allowed) => {
          if (conversation) {
            this.answer(conversation, requestId, allowed);
          }
        }),
      ),
    );
    if (conversation?.busy) {
      this.messages.append(thinking());
    }
    this.messages.scrollTop = this.messages.scrollHeight;
  }
}

function renderMessage(
  message: Message,
  onAnswer: (requestId: string, allowed: boolean) => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `message message-${message.role}`;

  if (message.role === "approval") {
    return renderApproval(message, onAnswer);
  }

  const text = document.createElement("p");
  text.textContent = message.text;
  wrapper.append(text);

  if (message.role === "assistant") {
    wrapper.append(...message.tools.map(renderTool));
  }
  return wrapper;
}

function renderApproval(
  message: Extract<Message, { role: "approval" }>,
  onAnswer: (requestId: string, allowed: boolean) => void,
): HTMLElement {
  const card = document.createElement("div");
  card.className = `approval approval-${message.status}`;

  const title = document.createElement("p");
  title.textContent = `O Claude quer usar ${message.toolName}`;

  const input = document.createElement("pre");
  input.textContent = JSON.stringify(message.input, null, 2);

  card.append(title, input);

  if (message.status === "pending") {
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "approval-allow";
    allow.textContent = "Permitir";
    allow.addEventListener("click", () => onAnswer(message.requestId, true));
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "approval-deny";
    deny.textContent = "Negar";
    deny.addEventListener("click", () => onAnswer(message.requestId, false));
    actions.append(deny, allow);
    card.append(actions);
  } else {
    const status = document.createElement("p");
    status.className = "approval-result";
    status.textContent = APPROVAL_LABEL[message.status];
    card.append(status);
  }
  return card;
}

const APPROVAL_LABEL: Record<
  Extract<Message, { role: "approval" }>["status"],
  string
> = {
  pending: "Aguardando resposta",
  allowed: "Permitido",
  denied: "Negado",
};

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

function createSelect(label: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  return select;
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

/** Remove chaves com valor indefinido, para o objeto atravessar o IPC limpo. */
function withoutUnset(settings: ChatSettings): ChatSettings {
  const result: ChatSettings = { mode: settings.mode };
  if (settings.model !== undefined) {
    result.model = settings.model;
  }
  if (settings.effort !== undefined) {
    result.effort = settings.effort;
  }
  return result;
}
