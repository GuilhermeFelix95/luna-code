import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
  spawn: (cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.spawn, cols, rows),
  write: (sessionId, data) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.write, sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.resize, sessionId, cols, rows),
  kill: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, sessionId),
  onOutput: (listener) =>
    subscribe<TerminalOutputPayload>(TERMINAL_CHANNELS.output, listener),
  onExit: (listener) =>
    subscribe<TerminalExitPayload>(TERMINAL_CHANNELS.exit, listener),
};

contextBridge.exposeInMainWorld("terminal", terminal);
