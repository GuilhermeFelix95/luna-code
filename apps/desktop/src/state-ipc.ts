// Canais de projetos e conversas. A lista fica no armazenamento do Luna; nada aqui toca em ~/.claude.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IpcMain } from "electron";
import {
  STATE_CHANNELS,
  type ConversationRecord,
  type PickedFolder,
  type Project,
  type StateSnapshot,
} from "./state-api";

export const MAX_STATE_ID_LENGTH = 64;
export const MAX_PATH_LENGTH = 1024;

export type PickFolder = () => Promise<PickedFolder | null>;

/** Parte do armazenamento que os canais de estado usam. */
export interface StateBook {
  snapshot(): StateSnapshot;
  addProject(folder: string): Project;
  removeProject(projectId: string): void;
  createConversation(projectId: string): ConversationRecord;
  hideConversation(conversationId: string): void;
}

export function registerStateIpc(
  ipc: IpcMain,
  book: StateBook,
  pickFolder: PickFolder,
): void {
  ipc.handle(STATE_CHANNELS.get, () => book.snapshot());

  ipc.handle(STATE_CHANNELS.pickProject, () => pickFolder());

  ipc.handle(STATE_CHANNELS.addProject, async (_event, folder: unknown) => {
    const resolved = parsePath(folder);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error("o projeto precisa ser uma pasta");
    }
    return book.addProject(resolved);
  });

  ipc.handle(STATE_CHANNELS.removeProject, (_event, projectId: unknown) => {
    book.removeProject(parseStateId(projectId, "projectId"));
  });

  ipc.handle(STATE_CHANNELS.createConversation, (_event, projectId: unknown) =>
    book.createConversation(parseStateId(projectId, "projectId")),
  );

  ipc.handle(
    STATE_CHANNELS.deleteConversation,
    (_event, conversationId: unknown) => {
      book.hideConversation(parseStateId(conversationId, "conversationId"));
    },
  );
}

/** Pasta pessoal é aceita, mas o renderer avisa antes de adicionar. */
export function isPersonalFolder(folder: string, homeDir: string): boolean {
  return path.resolve(folder) === path.resolve(homeDir);
}

function parseStateId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STATE_ID_LENGTH
  ) {
    throw new Error(
      `${label} deve ser texto de 1 a ${MAX_STATE_ID_LENGTH} caracteres`,
    );
  }
  return value;
}

function parsePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    !path.isAbsolute(value)
  ) {
    throw new Error("a pasta do projeto deve ser um caminho absoluto");
  }
  return path.resolve(value);
}
