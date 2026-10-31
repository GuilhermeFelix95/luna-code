// Contrato de projetos e conversas entre o processo principal, o preload e o renderer.
// Não importa nada do Electron nem do Node, para o renderer usar só os tipos.

import type { ChatSettings } from "./chat-api";

export const STATE_CHANNELS = {
  get: "state:get",
  pickProject: "project:pick",
  addProject: "project:add",
  removeProject: "project:remove",
  createConversation: "conversation:create",
  deleteConversation: "conversation:delete",
} as const;

export interface Project {
  id: string;
  name: string;
  /** Caminho absoluto da pasta, escolhido pelo usuário. */
  path: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  projectId: string;
  /** Sessão do Claude, para retomar com `resume`. Ausente até o primeiro turno. */
  sessionId?: string;
  settings: ChatSettings;
  /** Excluída pelo usuário: some da lista, mas o histórico do Claude fica no disco. */
  hidden: boolean;
}

/** Pasta escolhida no seletor. `personal` indica a pasta pessoal do usuário. */
export interface PickedFolder {
  path: string;
  personal: boolean;
}

/** O que o renderer recebe: só o que está visível na barra lateral. */
export interface StateSnapshot {
  projects: Project[];
  conversations: ConversationRecord[];
}

/** API de estado exposta ao renderer pelo preload. */
export interface StateBridge {
  snapshot(): Promise<StateSnapshot>;
  pickProject(): Promise<PickedFolder | null>;
  addProject(folder: string): Promise<Project>;
  removeProject(projectId: string): Promise<void>;
  createConversation(projectId: string): Promise<ConversationRecord>;
  deleteConversation(conversationId: string): Promise<void>;
}
