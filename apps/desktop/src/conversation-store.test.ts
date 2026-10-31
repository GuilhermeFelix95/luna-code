import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStore,
  DEFAULT_TITLE,
  TITLE_MAX_CHARS,
} from "./conversation-store";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "luna-store-"));
  file = path.join(directory, "luna-state.json");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Uma gravação pode ainda estar em andamento; o SO libera o diretório logo em seguida.
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

async function openStore(): Promise<ConversationStore> {
  return ConversationStore.open(file, () => undefined);
}

describe("ConversationStore", () => {
  it("adiciona projeto com o nome da pasta e recusa repetido", async () => {
    const store = await openStore();
    const folder = path.join(directory, "meu-app");

    const project = store.addProject(folder);

    expect(project.name).toBe("meu-app");
    expect(project.path).toBe(path.resolve(folder));
    expect(() => store.addProject(folder)).toThrow("já está na lista");
    await store.flush();
  });

  it("cria conversa herdando a última escolha de modo, modelo e esforço", async () => {
    const store = await openStore();
    const project = store.addProject(directory);
    const first = store.createConversation(project.id);
    store.recordTurn(
      first.id,
      { mode: "ask", model: "opus", effort: "high" },
      "oi",
    );

    const second = store.createConversation(project.id);

    expect(second.settings).toEqual({
      mode: "ask",
      model: "opus",
      effort: "high",
    });
    expect(second.title).toBe(DEFAULT_TITLE);
  });

  it("primeiro prompt vira título, encurtado", async () => {
    const store = await openStore();
    const project = store.addProject(directory);
    const conversation = store.createConversation(project.id);

    store.recordTurn(
      conversation.id,
      { mode: "readonly" },
      "x".repeat(TITLE_MAX_CHARS + 5),
    );

    const title = store.snapshot().conversations[0].title;
    expect(title).toHaveLength(TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });

  it("excluir conversa só a oculta; o registro de sessão continua no arquivo", async () => {
    const store = await openStore();
    const project = store.addProject(directory);
    const conversation = store.createConversation(project.id);
    store.recordSession(conversation.id, "sessao-1");

    store.hideConversation(conversation.id);
    await store.flush();

    expect(store.snapshot().conversations).toEqual([]);
    const reopened = await openStore();
    expect(reopened.snapshot().conversations).toEqual([]);
    expect(reopened.sessionOf(conversation.id)).toBe("sessao-1");
  });

  it("remover projeto oculta as conversas dele e não apaga a pasta", async () => {
    const store = await openStore();
    const project = store.addProject(directory);
    store.createConversation(project.id);

    store.removeProject(project.id);

    expect(store.snapshot()).toEqual({ projects: [], conversations: [] });
    await expect(fs.access(directory)).resolves.toBeUndefined();
  });

  it("a pasta de trabalho da conversa é a do projeto dela", async () => {
    const store = await openStore();
    const folder = path.join(directory, "projeto-a");
    await fs.mkdir(folder);
    const project = store.addProject(folder);
    const conversation = store.createConversation(project.id);

    expect(store.projectPathOf(conversation.id)).toBe(path.resolve(folder));
  });

  it("estado sobrevive a reabrir o armazenamento", async () => {
    const store = await openStore();
    const project = store.addProject(directory);
    const conversation = store.createConversation(project.id);
    store.recordSession(conversation.id, "sessao-9");
    store.recordTurn(
      conversation.id,
      { mode: "full", planning: true },
      "planeje",
    );
    await store.flush();

    const reopened = await openStore();

    expect(reopened.snapshot().conversations[0]).toMatchObject({
      id: conversation.id,
      title: "planeje",
      sessionId: "sessao-9",
      settings: { mode: "full", planning: true },
    });
  });

  it("projeto ou conversa desconhecidos são recusados", async () => {
    const store = await openStore();

    expect(() => store.createConversation("projeto-x")).toThrow(
      "projeto desconhecido",
    );
    expect(() => store.projectPathOf("conversa-x")).toThrow(
      "conversa desconhecida",
    );
  });
});
