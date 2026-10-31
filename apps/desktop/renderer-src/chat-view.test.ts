// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRecord, Project } from "../src/state-api";
import type { ChatBridge, ChatEventPayload, ChatModel } from "../src/chat-api";
import type { PickedFolder, StateBridge } from "../src/state-api";
import { ChatView, type ChatViewElements, type Confirm } from "./chat-view";

const PROJECT: Project = {
  id: "p1",
  name: "meu-app",
  path: "C:\\dev\\meu-app",
};

function record(
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  return {
    id: "c1",
    title: "Nova conversa",
    projectId: "p1",
    settings: { mode: "readonly" },
    hidden: false,
    ...overrides,
  };
}

interface Harness {
  view: ChatView;
  elements: ChatViewElements;
  bridge: {
    send: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };
  state: {
    snapshot: ReturnType<typeof vi.fn>;
    pickProject: ReturnType<typeof vi.fn>;
    addProject: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
    createConversation: ReturnType<typeof vi.fn>;
    deleteConversation: ReturnType<typeof vi.fn>;
  };
  confirm: ReturnType<typeof vi.fn<Confirm>>;
  emit: (payload: ChatEventPayload) => void;
}

function setup(options: {
  projects?: Project[];
  conversations?: ConversationRecord[];
  models?: ChatModel[];
  confirmAnswer?: boolean;
}): Harness {
  const elements: ChatViewElements = {
    host: document.createElement("div"),
    welcome: document.createElement("div"),
    list: document.createElement("div"),
    newChat: document.createElement("button"),
    addProject: document.createElement("button"),
    welcomeAddProject: document.createElement("button"),
  };
  document.body.replaceChildren(
    elements.host,
    elements.welcome,
    elements.list,
    elements.newChat,
    elements.addProject,
    elements.welcomeAddProject,
  );

  const listeners: Array<(payload: ChatEventPayload) => void> = [];
  const bridge = {
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    listModels: vi.fn(async () => options.models ?? []),
    open: vi.fn(async () => []),
    onEvent: vi.fn((listener: (payload: ChatEventPayload) => void) => {
      listeners.push(listener);
      return () => undefined;
    }),
  };

  const state = {
    snapshot: vi.fn(async () => ({
      projects: options.projects ?? [],
      conversations: options.conversations ?? [],
    })),
    pickProject: vi.fn(async (): Promise<PickedFolder | null> => null),
    addProject: vi.fn(async (folder: string): Promise<Project> => ({
      id: "p2",
      name: "novo",
      path: folder,
    })),
    removeProject: vi.fn(async () => undefined),
    createConversation: vi.fn(async (projectId: string) =>
      record({ id: "nova", projectId }),
    ),
    deleteConversation: vi.fn(async () => undefined),
  };

  const confirm = vi.fn<Confirm>(async () => options.confirmAnswer ?? true);

  const view = new ChatView(
    elements,
    bridge as unknown as ChatBridge,
    state as unknown as StateBridge,
    confirm,
    () => undefined,
  );

  return {
    view,
    elements,
    bridge,
    state,
    confirm,
    emit: (payload) => listeners.forEach((listener) => listener(payload)),
  };
}

/** Deixa as promessas pendentes de IPC terminarem. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function menuTriggers(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(".menu-trigger")];
}

function planButton(host: HTMLElement): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(".plan-switch")!;
}

function sidebarButton(list: HTMLElement, label: string): HTMLButtonElement {
  return list.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}

function typeAndSend(host: HTMLElement, text: string): void {
  const input = host.querySelector("textarea")!;
  input.value = text;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("ChatView: barra lateral e tela inicial", () => {
  it("sem conversa aberta, mostra a tela inicial e os projetos salvos", async () => {
    const { view, elements } = setup({ projects: [PROJECT] });

    await view.load();

    expect(elements.welcome.hidden).toBe(false);
    expect(elements.host.hidden).toBe(true);
    expect(elements.list.textContent).toContain("meu-app");
  });

  it("sem projeto, Nova conversa fica desabilitada e explica o motivo", async () => {
    const { view, elements } = setup({ projects: [] });

    await view.load();

    expect(elements.newChat.disabled).toBe(true);
    expect(elements.newChat.title).toBe("Adicione um projeto");
  });

  it("conversas aparecem dentro do seu projeto", async () => {
    const { view, elements } = setup({
      projects: [PROJECT],
      conversations: [record({ title: "Revisar o parser" })],
    });

    await view.load();

    const group = elements.list.querySelector(".project-group")!;
    expect(group.textContent).toContain("Revisar o parser");
  });
});

describe("ChatView: criar conversa", () => {
  it("cria no projeto do botão da barra lateral e abre a conversa", async () => {
    const { view, elements, state } = setup({ projects: [PROJECT] });
    await view.load();

    sidebarButton(elements.list, "Nova conversa em meu-app").click();
    await settle();

    expect(state.createConversation).toHaveBeenCalledWith("p1");
    expect(elements.host.hidden).toBe(false);
    expect(elements.welcome.hidden).toBe(true);
  });
});

describe("ChatView: Planejar", () => {
  it("ligado, trava o modo em Planejando e envia o planejamento", async () => {
    const { view, elements, bridge } = setup({ projects: [PROJECT] });
    await view.load();
    sidebarButton(elements.list, "Nova conversa em meu-app").click();
    await settle();

    planButton(elements.host).click();
    const [modeMenu] = menuTriggers(elements.host);

    expect(modeMenu!.textContent).toBe("Planejando");
    expect(modeMenu!.disabled).toBe(true);

    typeAndSend(elements.host, "planeje a tela");
    await settle();

    expect(bridge.send).toHaveBeenCalledWith("nova", "planeje a tela", {
      mode: "readonly",
      planning: true,
    });
  });

  it("desligado, volta ao modo escolhido antes", async () => {
    const { view, elements } = setup({ projects: [PROJECT] });
    await view.load();
    sidebarButton(elements.list, "Nova conversa em meu-app").click();
    await settle();

    planButton(elements.host).click();
    planButton(elements.host).click();

    const [modeMenu] = menuTriggers(elements.host);
    expect(modeMenu!.textContent).toBe("Somente leitura");
    expect(modeMenu!.disabled).toBe(false);
  });
});

describe("ChatView: adicionar projeto", () => {
  it("pasta comum: pede confirmação e adiciona ao aceitar", async () => {
    const { view, elements, state, confirm } = setup({});
    state.pickProject.mockResolvedValueOnce({
      path: "C:\\dev\\app",
      personal: false,
    });
    await view.load();

    elements.addProject.click();
    await settle();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Hooks definidos nessa pasta"),
      "Adicionar",
    );
    expect(state.addProject).toHaveBeenCalledWith("C:\\dev\\app");
    expect(elements.list.textContent).toContain("novo");
  });

  it("pasta pessoal: o aviso aparece na confirmação", async () => {
    const { view, elements, state, confirm } = setup({});
    state.pickProject.mockResolvedValueOnce({
      path: "C:\\Users\\guilh",
      personal: true,
    });
    await view.load();

    elements.addProject.click();
    await settle();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("pasta pessoal"),
      "Adicionar",
    );
  });

  it("pasta que já é projeto não é adicionada de novo e fica destacada", async () => {
    const { view, elements, state, confirm } = setup({ projects: [PROJECT] });
    state.pickProject.mockResolvedValueOnce({
      path: PROJECT.path,
      personal: false,
    });
    await view.load();

    elements.addProject.click();
    await settle();

    expect(confirm).not.toHaveBeenCalled();
    expect(state.addProject).not.toHaveBeenCalled();
    expect(elements.list.textContent).toContain("Esta pasta já é um projeto.");
    expect(
      elements.list
        .querySelector(".project-group")!
        .classList.contains("is-highlighted"),
    ).toBe(true);
  });

  it("recusado na confirmação, não adiciona", async () => {
    const { view, elements, state } = setup({ confirmAnswer: false });
    state.pickProject.mockResolvedValueOnce({
      path: "C:\\dev\\app",
      personal: false,
    });
    await view.load();

    elements.addProject.click();
    await settle();

    expect(state.addProject).not.toHaveBeenCalled();
  });

  it("cancelar o seletor de pasta não faz nada", async () => {
    const { view, elements, state, confirm } = setup({});
    await view.load();

    elements.addProject.click();
    await settle();

    expect(confirm).not.toHaveBeenCalled();
    expect(state.addProject).not.toHaveBeenCalled();
  });
});

describe("ChatView: excluir conversa", () => {
  it("confirmado, pede a exclusão ao armazenamento e tira da lista", async () => {
    const { view, elements, state, confirm } = setup({
      projects: [PROJECT],
      conversations: [record({ title: "Revisar o parser" })],
    });
    await view.load();

    sidebarButton(elements.list, "Excluir Revisar o parser da lista").click();
    await settle();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("histórico continua no disco do Claude"),
      "Excluir",
    );
    expect(state.deleteConversation).toHaveBeenCalledWith("c1");
    expect(elements.list.textContent).not.toContain("Revisar o parser");
  });

  it("recusado, mantém a conversa", async () => {
    const { view, elements, state } = setup({
      projects: [PROJECT],
      conversations: [record({ title: "Revisar o parser" })],
      confirmAnswer: false,
    });
    await view.load();

    sidebarButton(elements.list, "Excluir Revisar o parser da lista").click();
    await settle();

    expect(state.deleteConversation).not.toHaveBeenCalled();
    expect(elements.list.textContent).toContain("Revisar o parser");
  });
});

describe("ChatView: conversa salva", () => {
  it("ao abrir, lê o histórico do Claude e mostra as mensagens", async () => {
    const { view, elements, bridge } = setup({
      projects: [PROJECT],
      conversations: [record({ sessionId: "sessao-9", title: "oi" })],
    });
    bridge.open.mockResolvedValueOnce([
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá" },
    ]);
    await view.load();

    elements.list.querySelector<HTMLButtonElement>(".chat-item")!.click();
    await settle();

    expect(bridge.open).toHaveBeenCalledWith("c1");
    expect(elements.host.textContent).toContain("olá");
  });
});
