import { getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
} from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerChatIpc } from "./chat-ipc";
import { listClaudeModels, runClaudeTurn } from "./claude-runner";
import { ConversationStore } from "./conversation-store";
import { toHistoryMessages } from "./history";
import { sidecarEnv } from "./sidecar-env";
import { SidecarClient } from "./sidecar-client";
import { resolveSidecarBinary } from "./sidecar-path";
import { isPersonalFolder, registerStateIpc } from "./state-ipc";
import type { PickedFolder } from "./state-api";
import { buildProcessSpec } from "./terminal-spec";
import {
  forwardTerminalEvents,
  registerTerminalIpc,
  type TerminalIpc,
} from "./terminal-ipc";
import { createMainWindowOptions } from "./window-options";

let sidecar: SidecarClient | undefined;
let terminals: TerminalIpc | undefined;
let store: ConversationStore | undefined;
let mainWindow: BrowserWindow | undefined;
let quitReady = false;

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

/** Seletor de pasta nativo. Cancelar devolve null. */
async function pickFolder(): Promise<PickedFolder | null> {
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const [folder] = result.filePaths;
  if (result.canceled || folder === undefined) {
    return null;
  }
  return { path: folder, personal: isPersonalFolder(folder, os.homedir()) };
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
  .then(async () => {
    // Perfil isolado do Claude Code: login e histórico ficam aqui, não em ~/.claude.
    const profileDir = path.join(app.getPath("userData"), "claude-profile");
    fs.mkdirSync(profileDir, { recursive: true });
    // O SDK procura o histórico em CLAUDE_CONFIG_DIR deste processo, então aponta para o perfil.
    process.env.CLAUDE_CONFIG_DIR = profileDir;
    // Pasta de trabalho do Claude: nunca a pasta pessoal (ver buildProcessSpec).
    const workspaceDir = path.join(app.getPath("userData"), "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });

    const book = await ConversationStore.open(
      path.join(app.getPath("userData"), "luna-state.json"),
      (error) => {
        console.error(
          "Estado do Luna ilegível; o arquivo foi posto de lado:",
          error,
        );
      },
    );
    store = book;

    sidecar = startSidecar();
    terminals = registerTerminalIpc(ipcMain, sidecar, (kind) =>
      buildProcessSpec(kind, {
        claudeProfileDir: profileDir,
        workspaceDir,
      }),
    );
    forwardTerminalEvents(sidecar, sendToRenderer);
    registerStateIpc(ipcMain, book, pickFolder);
    registerChatIpc(
      ipcMain,
      book,
      (request) =>
        runClaudeTurn(
          {
            prompt: request.prompt,
            mode: request.settings.mode,
            model: request.settings.model,
            effort: request.settings.effort,
            planning: request.settings.planning,
            sessionId: request.sessionId,
            // Cada conversa roda na pasta do próprio projeto.
            cwd: book.projectPathOf(request.conversationId),
            configDir: profileDir,
            canUseTool: request.canUseTool,
            abortController: request.abortController,
          },
          query,
        ),
      () =>
        listClaudeModels(query, { cwd: workspaceDir, configDir: profileDir }),
      async (conversationId) => {
        const sessionId = book.sessionOf(conversationId);
        if (sessionId === undefined) {
          return [];
        }
        const messages = await getSessionMessages(sessionId, {
          dir: book.projectPathOf(conversationId),
        });
        return toHistoryMessages(messages);
      },
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
  if (quitReady) {
    return;
  }
  // Os Claudes precisam de tempo para sair e as gravações precisam terminar antes do sidecar cair.
  event.preventDefault();
  void closeEverything().finally(() => {
    quitReady = true;
    app.quit();
  });
});

async function closeEverything(): Promise<void> {
  try {
    await terminals?.closeAll();
  } catch (error: unknown) {
    console.error("Falha ao encerrar os terminais:", error);
  }
  await store?.flush();
  sidecar?.stop();
}

app.on("window-all-closed", () => {
  app.quit();
});
