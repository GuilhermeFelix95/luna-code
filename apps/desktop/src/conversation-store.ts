// Projetos e conversas do Luna, com gravação em fila. O processo principal é a fonte da verdade.

import * as path from "node:path";
import type { ChatSettings } from "./chat-api";
import { loadAppState, saveAppState, type AppState } from "./app-state";
import type { ConversationRecord, Project, StateSnapshot } from "./state-api";

export const DEFAULT_TITLE = "Nova conversa";
export const TITLE_MAX_CHARS = 40;

export class ConversationStore {
  /** Cadeia de gravações: uma termina antes da próxima começar. */
  private writing: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(
    private readonly file: string,
    private state: AppState,
  ) {
    this.sequence = Date.now();
  }

  /** Abre o armazenamento do arquivo. Arquivo corrompido é reportado por `onCorrupt`. */
  static async open(
    file: string,
    onCorrupt: (error: unknown) => void,
  ): Promise<ConversationStore> {
    const state = await loadAppState(file, onCorrupt);
    return new ConversationStore(file, state);
  }

  snapshot(): StateSnapshot {
    return {
      projects: [...this.state.projects],
      conversations: this.state.conversations
        .filter((conversation) => !conversation.hidden)
        .map((conversation) => ({ ...conversation })),
    };
  }

  addProject(folder: string): Project {
    const resolved = path.resolve(folder);
    if (this.state.projects.some((project) => project.path === resolved)) {
      throw new Error("este projeto já está na lista");
    }
    const project: Project = {
      id: this.nextId("projeto"),
      name: path.basename(resolved) || resolved,
      path: resolved,
    };
    this.state.projects.push(project);
    this.persist();
    return project;
  }

  /** Tira o projeto da lista e oculta as conversas dele. A pasta e o histórico não são tocados. */
  removeProject(projectId: string): void {
    this.requireProject(projectId);
    this.state.projects = this.state.projects.filter(
      (project) => project.id !== projectId,
    );
    for (const conversation of this.state.conversations) {
      if (conversation.projectId === projectId) {
        conversation.hidden = true;
      }
    }
    this.persist();
  }

  createConversation(projectId: string): ConversationRecord {
    this.requireProject(projectId);
    const last = this.state.conversations.at(-1);
    const conversation: ConversationRecord = {
      id: this.nextId("conversa"),
      title: DEFAULT_TITLE,
      projectId,
      // Herda a última escolha, como o seletor já fazia na memória.
      settings: { ...(last?.settings ?? { mode: "readonly" }) },
      hidden: false,
    };
    this.state.conversations.push(conversation);
    this.persist();
    return conversation;
  }

  /** Exclusão só remove da lista do Luna. O histórico do Claude continua no disco. */
  hideConversation(conversationId: string): void {
    this.requireConversation(conversationId).hidden = true;
    this.persist();
  }

  /** Pasta de trabalho da conversa: a do projeto dela. */
  projectPathOf(conversationId: string): string {
    const conversation = this.requireConversation(conversationId);
    return this.requireProject(conversation.projectId).path;
  }

  sessionOf(conversationId: string): string | undefined {
    return this.requireConversation(conversationId).sessionId;
  }

  recordSession(conversationId: string, sessionId: string): void {
    this.requireConversation(conversationId).sessionId = sessionId;
    this.persist();
  }

  /** Grava as configurações usadas no envio e dá título à conversa na primeira mensagem. */
  recordTurn(
    conversationId: string,
    settings: ChatSettings,
    prompt: string,
  ): void {
    const conversation = this.requireConversation(conversationId);
    conversation.settings = { ...settings };
    if (conversation.title === DEFAULT_TITLE) {
      conversation.title = shorten(prompt);
    }
    this.persist();
  }

  /** Espera as gravações pendentes. Usado ao fechar o app. */
  flush(): Promise<void> {
    return this.writing;
  }

  private persist(): void {
    const snapshot = structuredClone(this.state);
    this.writing = this.writing
      .then(() => saveAppState(this.file, snapshot))
      .catch((error: unknown) => {
        console.error("Falha ao salvar o estado do Luna:", error);
      });
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private requireProject(projectId: string): Project {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`projeto desconhecido: ${projectId}`);
    }
    return project;
  }

  private requireConversation(conversationId: string): ConversationRecord {
    const conversation = this.state.conversations.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) {
      throw new Error(`conversa desconhecida: ${conversationId}`);
    }
    return conversation;
  }
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_CHARS
    ? `${oneLine.slice(0, TITLE_MAX_CHARS - 1)}…`
    : oneLine;
}
