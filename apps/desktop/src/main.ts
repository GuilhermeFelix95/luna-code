import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { SidecarClient } from "./sidecar-client";
import { resolveSidecarBinary } from "./sidecar-path";
import { forwardTerminalEvents, registerTerminalIpc } from "./terminal-ipc";
import { createMainWindowOptions } from "./window-options";

let sidecar: SidecarClient | undefined;
let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  const win = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, "preload.js")),
  );
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = undefined;
  });

  win
    .loadFile(path.join(__dirname, "..", "renderer", "index.html"))
    .catch((error: unknown) => {
      console.error("Falha ao carregar a janela principal:", error);
      process.exitCode = 1;
      app.quit();
    });
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function startSidecar(): SidecarClient {
  const binary = resolveSidecarBinary(__dirname, process.platform);
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  const client = new SidecarClient(child);

  client
    .ping()
    .then((result) => console.log("sidecar respondeu:", result))
    .catch((error: unknown) => {
      console.error("Falha ao falar com o sidecar:", error);
    });
  return client;
}

app
  .whenReady()
  .then(() => {
    sidecar = startSidecar();
    registerTerminalIpc(ipcMain, sidecar);
    forwardTerminalEvents(sidecar, sendToRenderer);
    createWindow();
  })
  .catch((error: unknown) => {
    console.error("Falha ao iniciar o aplicativo:", error);
    process.exitCode = 1;
    app.quit();
  });

app.on("will-quit", () => {
  sidecar?.stop();
});

app.on("window-all-closed", () => {
  app.quit();
});
