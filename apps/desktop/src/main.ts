import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { SidecarClient } from "./sidecar-client";
import { resolveSidecarBinary } from "./sidecar-path";
import { createMainWindowOptions } from "./window-options";

let sidecar: SidecarClient | undefined;

function createWindow(): void {
  const win = new BrowserWindow(createMainWindowOptions());
  win
    .loadFile(path.join(__dirname, "..", "renderer", "index.html"))
    .catch((error: unknown) => {
      console.error("Falha ao carregar a janela principal:", error);
      process.exitCode = 1;
      app.quit();
    });
}

function startSidecar(): void {
  const binary = resolveSidecarBinary(__dirname, process.platform);
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  sidecar = new SidecarClient(child);

  sidecar
    .ping()
    .then((result) => console.log("sidecar respondeu:", result))
    .catch((error: unknown) => {
      console.error("Falha ao falar com o sidecar:", error);
    });
}

app
  .whenReady()
  .then(() => {
    startSidecar();
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
