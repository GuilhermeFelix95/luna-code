import type { BrowserWindowConstructorOptions } from "electron";

export const WINDOW_WIDTH = 1280;
export const WINDOW_HEIGHT = 800;

// Isolamento de contexto e sandbox ativos: o renderer não acessa Node diretamente.
export function createMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}
