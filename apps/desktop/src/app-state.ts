// Estado salvo do Luna: projetos e conversas, para o app retomar ao abrir.
// Fica num arquivo JSON no perfil do app. Nada aqui grava em ~/.claude.

import * as fs from "node:fs/promises";
import { CHAT_MODES, EFFORT_LEVELS, type ChatSettings } from "./chat-api";
import type { ConversationRecord, Project } from "./state-api";

export const APP_STATE_VERSION = 1;

export interface AppState {
  version: typeof APP_STATE_VERSION;
  projects: Project[];
  conversations: ConversationRecord[];
}

export function emptyAppState(): AppState {
  return { version: APP_STATE_VERSION, projects: [], conversations: [] };
}

/** Valida o JSON lido do disco. Qualquer desvio lança erro, sem preencher valores padrão. */
export function parseAppState(value: unknown): AppState {
  const root = expectObject(value, "estado");
  if (root.version !== APP_STATE_VERSION) {
    throw new Error(`versão de estado não suportada: ${String(root.version)}`);
  }
  return {
    version: APP_STATE_VERSION,
    projects: expectArray(root.projects, "projects").map(parseProject),
    conversations: expectArray(root.conversations, "conversations").map(
      parseConversation,
    ),
  };
}

function parseProject(value: unknown): Project {
  const item = expectObject(value, "projeto");
  return {
    id: expectString(item.id, "projeto.id"),
    name: expectString(item.name, "projeto.name"),
    path: expectString(item.path, "projeto.path"),
  };
}

function parseConversation(value: unknown): ConversationRecord {
  const item = expectObject(value, "conversa");
  const record: ConversationRecord = {
    id: expectString(item.id, "conversa.id"),
    title: expectString(item.title, "conversa.title"),
    projectId: expectString(item.projectId, "conversa.projectId"),
    settings: parseSettings(item.settings),
    hidden: expectBoolean(item.hidden, "conversa.hidden"),
  };
  if (item.sessionId !== undefined) {
    record.sessionId = expectString(item.sessionId, "conversa.sessionId");
  }
  return record;
}

function parseSettings(value: unknown): ChatSettings {
  const item = expectObject(value, "conversa.settings");
  if (!CHAT_MODES.some((mode) => mode === item.mode)) {
    throw new Error(`conversa.settings.mode inválido: ${String(item.mode)}`);
  }
  const settings: ChatSettings = { mode: item.mode as ChatSettings["mode"] };
  if (item.model !== undefined) {
    settings.model = expectString(item.model, "conversa.settings.model");
  }
  if (item.effort !== undefined) {
    if (!EFFORT_LEVELS.some((level) => level === item.effort)) {
      throw new Error(
        `conversa.settings.effort inválido: ${String(item.effort)}`,
      );
    }
    settings.effort = item.effort as ChatSettings["effort"];
  }
  if (item.planning !== undefined) {
    settings.planning = expectBoolean(
      item.planning,
      "conversa.settings.planning",
    );
  }
  return settings;
}

/**
 * Lê o estado do disco. Arquivo ausente vira estado vazio. Arquivo ilegível é posto
 * de lado com outro nome (não se perde o conteúdo) e o erro vai para o log.
 */
export async function loadAppState(
  file: string,
  onCorrupt: (error: unknown) => void = () => undefined,
): Promise<AppState> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return emptyAppState();
    }
    throw error;
  }

  try {
    return parseAppState(JSON.parse(text));
  } catch (error: unknown) {
    onCorrupt(error);
    await fs.rename(file, `${file}.corrompido-${Date.now()}`);
    return emptyAppState();
  }
}

/** Grava em arquivo temporário e troca de nome: um corte de energia não deixa o arquivo pela metade. */
export async function saveAppState(
  file: string,
  state: AppState,
): Promise<void> {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, file);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} deve ser um objeto`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} deve ser uma lista`);
  }
  return value;
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} deve ser texto não vazio`);
  }
  return value;
}

function expectBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} deve ser verdadeiro ou falso`);
  }
  return value;
}
