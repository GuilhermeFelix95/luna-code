import { query } from "@anthropic-ai/claude-agent-sdk";
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerChatIpc } from "./chat-ipc";
import { runClaudeTurn } from "./claude-runner";
import { sidecarEnv } from "./sidecar-env";
import { SidecarClient } from "./sidecar-client";
import { resolveSidecarBinary } from "./sidecar-path";
import { buildProcessSpec } from "./terminal-spec";
import {
  forwardTerminalEvents,
  registerTerminalIpc,
  type TerminalIpc,
} from "./terminal-ipc";
import { createMainWindowOptions } from "./window-options";

let sidecar: SidecarClient | undefined;
let terminals: TerminalIpc | undefined;
let terminalsClosed = false;
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
  const child = spawn(binary, [], {
    stdio: ["pipe", "pipe", "inherit"],
    env: sidecarEnv(process.env),
  });
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
    // Perfil isolado do Claude Code: login e histórico ficam aqui, não em ~/.claude.
    const profileDir = path.join(app.getPath("userData"), "claude-profile");
    fs.mkdirSync(profileDir, { recursive: true });
    // Pasta de trabalho do Claude: nunca a pasta pessoal (ver buildProcessSpec).
    const workspaceDir = path.join(app.getPath("userData"), "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    sidecar = startSidecar();
    terminals = registerTerminalIpc(ipcMain, sidecar, (kind) =>
      buildProcessSpec(kind, {
        claudeProfileDir: profileDir,
        workspaceDir,
      }),
    );
    forwardTerminalEvents(sidecar, sendToRenderer);
    // Etapa 2: só leitura. Sem pergunta ao usuário, qualquer chamada que precise de aprovação é negada.
    registerChatIpc(
      ipcMain,
      (request) =>
        runClaudeTurn(
          {
            prompt: request.prompt,
            mode: "readonly",
            sessionId: request.sessionId,
            cwd: workspaceDir,
            configDir: profileDir,
            canUseTool: async () => ({
              behavior: "deny",
              message: "Aprovação de ferramentas ainda não está disponível.",
            }),
            abortController: request.abortController,
          },
          query,
        ),
      sendToRenderer,
    );
    createWindow();
  })
  .catch((error: unknown) => {
    console.error("Falha ao iniciar o aplicativo:", error);
    process.exitCode = 1;
    app.quit();
  });

app.on("will-quit", (event) => {
  if (!terminals || terminalsClosed) {
    sidecar?.stop();
    return;
  }
  // Os Claudes precisam de tempo para sair e gravar a configuração antes do sidecar cair.
  event.preventDefault();
  terminalsClosed = true;
  terminals
    .closeAll()
    .catch((error: unknown) => {
      console.error("Falha ao encerrar os terminais:", error);
    })
    .finally(() => {
      sidecar?.stop();
      app.quit();
    });
});

app.on("window-all-closed", () => {
  app.quit();
});
