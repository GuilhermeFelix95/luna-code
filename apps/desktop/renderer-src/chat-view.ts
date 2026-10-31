// Tela de conversa com o Claude e barra lateral de projetos. O Claude roda por baixo; o usuário vê
// mensagens, cartões e a lista de projetos. Todo texto vai por textContent, nunca por innerHTML:
// a saída do modelo não é HTML confiável.

import type { Project } from "../src/state-api";
import {
  CHAT_MODES,
  type ChatBridge,
  type ChatMode,
  type ChatModel,
  type ChatSettings,
  type EffortLevel,
} from "../src/chat-api";
import type { StateBridge } from "../src/state-api";
import {
  addUserMessage,
  applyEvent,
  conversationFromRecord,
  resolveApproval,
  setHistory,
  type Conversation,
  type Message,
  type ToolCall,
} from "./conversation";
import { Menu, type MenuItem } from "./menu";

/** Pede confirmação ao usuário. Resolve true só quando ele confirma. */
export type Confirm = (message: string, action: string) => Promise<boolean>;

export interface ChatViewElements {
  /** Área da conversa: mensagens e campo de envio. */
  host: HTMLElement;
  /** Tela inicial vazia, mostrada quando nenhuma conversa está aberta. */
  welcome: HTMLElement;
  /** Barra lateral com os projetos e as conversas de cada um. */
  list: HTMLElement;
  newChat: HTMLButtonElement;
  addProject: HTMLButtonElement;
  welcomeAddProject: HTMLButtonElement;
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

/** Valor que significa "padrão do modelo" (nada é enviado). */
const DEFAULT_OPTION = "";
/** Valor do menu de modo enquanto Planejar está ligado. Substitui o modo escolhido. */
const PLANNING_OPTION = "planning";
const PLANNING_LABEL = "Planejando";

export class ChatView {
  private projects: Project[] = [];
  private conversations: Conversation[] = [];
  private current: Conversation | undefined;
  /** Projetos recolhidos na barra lateral. */
  private readonly collapsed = new Set<string>();
  /** Projeto destacado na barra lateral, quando uma adição repetida aponta para ele. */
  private highlightedProjectId: string | undefined;
  /** Última escolha de modo, modelo, esforço e planejar. Conversas novas começam com ela. */
  private lastSettings: ChatSettings = { mode: "readonly" };
  private models: ChatModel[] = [];
  private modelsFailed = false;
  /** Aviso mostrado na barra lateral, por exemplo quando uma ação falha. */
  private notice = "";
  private readonly messages: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly planButton: HTMLButtonElement;
  private readonly modeMenu: Menu;
  private readonly modelMenu: Menu;
  private readonly effortMenu: Menu;

  constructor(
    private readonly elements: ChatViewElements,
    private readonly bridge: ChatBridge,
    private readonly state: StateBridge,
    private readonly confirm: Confirm,
    /** Mostra a área da conversa e esconde o terminal. */
    private readonly onShowChat: () => void,
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

    this.planButton = document.createElement("button");
    this.planButton.type = "button";
    this.planButton.className = "plan-switch";
    this.planButton.setAttribute("role", "switch");
    this.planButton.setAttribute("aria-checked", "false");
    this.planButton.textContent = "Planejar";

    this.modeMenu = new Menu("Modo de permissão", (value) => {
      this.updateSettings({ mode: value as ChatMode });
    });
    this.modelMenu = new Menu("Modelo", (value) => {
      this.changeModel(value === DEFAULT_OPTION ? undefined : value);
    });
    this.effortMenu = new Menu("Esforço", (value) => {
      this.updateSettings({
        effort: value === DEFAULT_OPTION ? undefined : (value as EffortLevel),
      });
    });

    this.elements.host.append(this.messages, this.buildComposer());

    this.planButton.addEventListener("click", () => {
      this.updateSettings({
        planning: this.activeSettings().planning !== true,
      });
    });

    bridge.onEvent(({ conversationId, event }) => {
      const conversation = this.conversations.find(
        (candidate) => candidate.id === conversationId,
      );
      if (!conversation) {
        return;
      }
      applyEvent(conversation, event);
      if (conversation === this.current) {
        this.renderMessages();
        // O fim do turno destrava os controles; durante o texto eles ficam como estão.
        if (event.type === "turn-end") {
          this.renderFooter();
        }
      }
    });

    this.elements.newChat.addEventListener("click", () => {
      void this.newConversation();
    });
    this.elements.addProject.addEventListener("click", () => {
      void this.addProject();
    });
    this.elements.welcomeAddProject.addEventListener("click", () => {
      void this.addProject();
    });

    this.loadModels();
    this.renderFooter();
  }

  /** Carrega projetos e conversas salvos e abre a tela inicial. Chamado uma vez, ao abrir o app. */
  async load(): Promise<void> {
    const snapshot = await this.state.snapshot();
    this.projects = snapshot.projects;
    this.conversations = snapshot.conversations.map(conversationFromRecord);
    this.showWelcome();
  }

  /**
   * Cria uma conversa no projeto dado. Sem projeto informado, usa o da conversa aberta ou o primeiro.
   * Devolve undefined quando não há projeto ou a criação falha.
   */
  async newConversation(
    projectId: string | undefined = this.current?.projectId ??
      this.projects[0]?.id,
  ): Promise<Conversation | undefined> {
    if (projectId === undefined) {
      return undefined;
    }
    try {
      const record = await this.state.createConversation(projectId);
      const conversation = conversationFromRecord(record);
      this.conversations.push(conversation);
      this.notice = "";
      this.select(conversation);
      return conversation;
    } catch (error: unknown) {
      this.fail("Não foi possível criar a conversa", error);
      return undefined;
    }
  }

  /** Abre o seletor de pasta, pede confirmação e adiciona o projeto. */
  async addProject(): Promise<void> {
    try {
      const picked = await this.state.pickProject();
      if (!picked) {
        return;
      }
      const existing = this.projects.find(
        (project) => project.path === picked.path,
      );
      if (existing) {
        // Pasta repetida: não cria duplicata. Mostra o motivo e destaca o projeto já existente.
        this.collapsed.delete(existing.id);
        this.highlightedProjectId = existing.id;
        this.notice = "Esta pasta já é um projeto.";
        this.renderList();
        return;
      }
      const name = basename(picked.path);
      const warning = picked.personal
        ? " Esta é a sua pasta pessoal: o Claude pode ler e alterar tudo nela."
        : "";
      const ok = await this.confirm(
        `Adicionar ${name} como projeto?${warning} O Claude vai carregar o CLAUDE.md e a pasta .claude/ dela. Hooks definidos nessa pasta podem executar comandos.`,
        "Adicionar",
      );
      if (!ok) {
        return;
      }
      const project = await this.state.addProject(picked.path);
      this.projects = [...this.projects, project];
      this.notice = "";
      this.highlightedProjectId = undefined;
      this.renderList();
      // Projeto novo já abre uma conversa, para o usuário começar sem outro clique.
      // newConversation trata as próprias falhas, então não cai no catch abaixo.
      await this.newConversation(project.id);
    } catch (error: unknown) {
      this.fail("Não foi possível adicionar o projeto", error);
    }
  }

  private select(conversation: Conversation): void {
    this.current = conversation;
    this.onShowChat();
    this.elements.welcome.hidden = true;
    this.elements.host.hidden = false;
    this.renderList();
    this.renderMessages();
    this.renderFooter();
    this.input.focus();
    if (!conversation.historyLoaded) {
      void this.loadHistory(conversation);
    }
  }

  /** Lê o histórico de uma conversa salva. Se falhar, a conversa tenta de novo na próxima abertura. */
  private async loadHistory(conversation: Conversation): Promise<void> {
    try {
      setHistory(conversation, await this.bridge.open(conversation.id));
    } catch (error: unknown) {
      console.error("Falha ao abrir a conversa salva:", error);
      conversation.messages.push({ role: "error", text: String(error) });
    }
    if (conversation === this.current) {
      this.renderMessages();
    }
  }

  private showWelcome(): void {
    this.current = undefined;
    this.elements.host.hidden = true;
    this.elements.welcome.hidden = false;
    this.onShowChat();
    this.renderList();
    this.renderFooter();
  }

  private async deleteConversation(conversation: Conversation): Promise<void> {
    const ok = await this.confirm(
      `Excluir "${conversation.title}" da lista do Luna? O histórico continua no disco do Claude e não é apagado.`,
      "Excluir",
    );
    if (!ok) {
      return;
    }
    try {
      if (conversation.busy) {
        await this.bridge.stop(conversation.id);
      }
      await this.state.deleteConversation(conversation.id);
    } catch (error: unknown) {
      this.fail("Não foi possível excluir a conversa", error);
      return;
    }
    this.conversations = this.conversations.filter(
      (candidate) => candidate !== conversation,
    );
    if (this.current === conversation) {
      this.showWelcome();
    } else {
      this.renderList();
    }
  }

  private async removeProject(project: Project): Promise<void> {
    const ok = await this.confirm(
      `Remover ${project.name} da lista do Luna? A pasta e o histórico do Claude não são apagados. As conversas dele saem da lista.`,
      "Remover",
    );
    if (!ok) {
      return;
    }
    try {
      await this.state.removeProject(project.id);
    } catch (error: unknown) {
      this.fail("Não foi possível remover o projeto", error);
      return;
    }
    this.projects = this.projects.filter(
      (candidate) => candidate.id !== project.id,
    );
    this.conversations = this.conversations.filter(
      (conversation) => conversation.projectId !== project.id,
    );
    if (this.current && this.current.projectId === project.id) {
      this.showWelcome();
    } else {
      this.renderList();
    }
  }

  private buildComposer(): HTMLFormElement {
    const form = document.createElement("form");
    form.className = "chat-composer";

    const footer = document.createElement("div");
    footer.className = "chat-composer-footer";
    const selectors = document.createElement("div");
    selectors.className = "chat-selectors";
    selectors.append(
      this.planButton,
      this.modeMenu.element,
      this.modelMenu.element,
      this.effortMenu.element,
    );
    footer.append(selectors, this.sendButton);

    form.append(this.input, footer);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.input.addEventListener("keydown", (event) => {
      // Enter só envia; parar a resposta fica no botão, para não cancelar sem querer.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!this.current?.busy) {
          void this.send();
        }
      }
    });
    return form;
  }

  /** Configuração em uso: a da conversa aberta ou a última escolha. */
  private activeSettings(): ChatSettings {
    return this.current?.settings ?? this.lastSettings;
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

  /** Um nível de esforço que o novo modelo não aceita volta ao padrão. */
  private changeModel(model: string | undefined): void {
    const effort = this.levelsFor(model).includes(
      this.activeSettings().effort as EffortLevel,
    )
      ? this.activeSettings().effort
      : undefined;
    this.updateSettings({ model, effort });
  }

  /** Envia a mensagem, ou para a resposta em andamento quando o botão está em "Parar". */
  private async send(): Promise<void> {
    if (this.current?.busy) {
      void this.bridge.stop(this.current.id);
      return;
    }
    const text = this.input.value.trim();
    if (text.length === 0) {
      return;
    }
    const conversation = this.current ?? (await this.newConversation());
    if (!conversation || conversation.busy) {
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
        this.renderFooter();
      },
      (error: unknown) => {
        console.error("Falha ao listar modelos:", error);
        this.modelsFailed = true;
        this.renderFooter();
      },
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
    const settings = this.activeSettings();
    const busy = this.current?.busy === true;
    const planning = settings.planning === true;

    this.planButton.setAttribute("aria-checked", String(planning));
    this.planButton.classList.toggle("is-on", planning);
    this.planButton.disabled = busy;

    // Com Planejar ligado, o modo escolhido fica guardado e o menu mostra só "Planejando".
    this.modeMenu.setOptions(
      planning
        ? [{ value: PLANNING_OPTION, label: PLANNING_LABEL }]
        : CHAT_MODES.map((mode) => ({ value: mode, label: MODE_LABEL[mode] })),
      planning ? PLANNING_OPTION : settings.mode,
    );
    this.modeMenu.setDisabled(busy || planning);

    this.modelMenu.setOptions(
      this.modelItems(),
      settings.model ?? DEFAULT_OPTION,
    );
    this.modelMenu.setDisabled(busy || this.modelsFailed);

    this.effortMenu.setOptions(
      [
        { value: DEFAULT_OPTION, label: "Padrão do modelo" },
        ...this.levelsFor(settings.model).map((level) => ({
          value: level,
          label: EFFORT_LABEL[level],
        })),
      ],
      settings.effort ?? DEFAULT_OPTION,
    );
    this.effortMenu.setDisabled(busy);
  }

  private modelItems(): MenuItem[] {
    if (this.modelsFailed) {
      return [{ value: DEFAULT_OPTION, label: "Modelos indisponíveis" }];
    }
    return [
      { value: DEFAULT_OPTION, label: "Padrão do modelo" },
      ...this.models.map((model) => ({
        value: model.value,
        label: model.displayName,
      })),
    ];
  }

  private renderList(): void {
    const children: HTMLElement[] = [];
    if (this.notice) {
      const notice = document.createElement("p");
      notice.className = "sidebar-notice";
      notice.setAttribute("role", "alert");
      notice.textContent = this.notice;
      children.push(notice);
    }
    for (const project of this.projects) {
      children.push(this.renderProject(project));
    }
    this.elements.list.replaceChildren(...children);

    // Sem projeto não há onde criar conversa: o botão fica desabilitado e explica o motivo.
    const hasProject = this.projects.length > 0;
    this.elements.newChat.disabled = !hasProject;
    this.elements.newChat.title = hasProject ? "" : "Adicione um projeto";
  }

  private renderProject(project: Project): HTMLElement {
    const group = document.createElement("section");
    group.className = "project-group";
    group.classList.toggle(
      "is-highlighted",
      project.id === this.highlightedProjectId,
    );

    const expanded = !this.collapsed.has(project.id);
    const header = document.createElement("div");
    header.className = "project-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "project-toggle";
    toggle.textContent = project.name;
    toggle.title = project.path;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.addEventListener("click", () => {
      if (expanded) {
        this.collapsed.add(project.id);
      } else {
        this.collapsed.delete(project.id);
      }
      this.renderList();
    });

    const add = iconButton(
      `Nova conversa em ${project.name}`,
      "+",
      "project-add",
    );
    add.addEventListener("click", () => {
      void this.newConversation(project.id);
    });
    const remove = iconButton(
      `Remover ${project.name} da lista`,
      "×",
      "project-remove",
    );
    remove.addEventListener("click", () => {
      void this.removeProject(project);
    });

    header.append(toggle, add, remove);
    group.append(header);

    if (expanded) {
      const list = document.createElement("ul");
      list.className = "chat-list";
      for (const conversation of this.conversations) {
        if (conversation.projectId === project.id) {
          list.append(this.renderConversation(conversation));
        }
      }
      group.append(list);
    }
    return group;
  }

  private renderConversation(conversation: Conversation): HTMLElement {
    const item = document.createElement("li");
    item.className = "chat-row";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "chat-item";
    open.textContent = conversation.title;
    if (conversation === this.current) {
      open.setAttribute("aria-current", "true");
    }
    open.addEventListener("click", () => this.select(conversation));

    const remove = iconButton(
      `Excluir ${conversation.title} da lista`,
      "×",
      "chat-delete",
    );
    remove.addEventListener("click", () => {
      void this.deleteConversation(conversation);
    });

    item.append(open, remove);
    return item;
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

  private fail(message: string, error: unknown): void {
    console.error(`${message}:`, error);
    this.notice = `${message}.`;
    this.renderList();
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

function iconButton(
  label: string,
  symbol: string,
  className: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.textContent = symbol;
  return button;
}

function basename(folder: string): string {
  return (
    folder
      .split(/[\\/]/)
      .filter((part) => part.length > 0)
      .at(-1) ?? folder
  );
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
  if (settings.planning !== undefined) {
    result.planning = settings.planning;
  }
  return result;
}
