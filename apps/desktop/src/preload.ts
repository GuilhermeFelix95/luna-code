import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  CHAT_CHANNELS,
  type ChatBridge,
  type ChatEventPayload,
} from "./chat-api";
import { STATE_CHANNELS, type StateBridge } from "./state-api";
import {
  TERMINAL_CHANNELS,
  type TerminalBridge,
  type TerminalExitPayload,
  type TerminalOutputPayload,
} from "./terminal-api";

// Expõe só a API fixa do terminal. ipcRenderer e Node não atravessam a fronteira.
function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void =>
    listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const terminal: TerminalBridge = {
  spawn: (kind, cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.spawn, kind, cols, rows),
  write: (sessionId, data) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.write, sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.resize, sessionId, cols, rows),
  close: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.close, sessionId),
  kill: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, sessionId),
  onOutput: (listener) =>
    subscribe<TerminalOutputPayload>(TERMINAL_CHANNELS.output, listener),
  onExit: (listener) =>
    subscribe<TerminalExitPayload>(TERMINAL_CHANNELS.exit, listener),
};

const chat: ChatBridge = {
  send: (conversationId, text, settings) =>
    ipcRenderer.invoke(CHAT_CHANNELS.send, conversationId, text, settings),
  stop: (conversationId) =>
    ipcRenderer.invoke(CHAT_CHANNELS.stop, conversationId),
  approve: (requestId, allowed) =>
    ipcRenderer.invoke(CHAT_CHANNELS.approve, requestId, allowed),
  listModels: () => ipcRenderer.invoke(CHAT_CHANNELS.models),
  open: (conversationId) =>
    ipcRenderer.invoke(CHAT_CHANNELS.open, conversationId),
  onEvent: (listener) =>
    subscribe<ChatEventPayload>(CHAT_CHANNELS.event, listener),
};

const state: StateBridge = {
  snapshot: () => ipcRenderer.invoke(STATE_CHANNELS.get),
  pickProject: () => ipcRenderer.invoke(STATE_CHANNELS.pickProject),
  addProject: (folder) => ipcRenderer.invoke(STATE_CHANNELS.addProject, folder),
  removeProject: (projectId) =>
    ipcRenderer.invoke(STATE_CHANNELS.removeProject, projectId),
  createConversation: (projectId) =>
    ipcRenderer.invoke(STATE_CHANNELS.createConversation, projectId),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke(STATE_CHANNELS.deleteConversation, conversationId),
};

contextBridge.exposeInMainWorld("terminal", terminal);
contextBridge.exposeInMainWorld("chat", chat);
contextBridge.exposeInMainWorld("state", state);
