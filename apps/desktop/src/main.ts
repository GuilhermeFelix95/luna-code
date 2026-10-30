import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { createMainWindowOptions } from "./window-options";

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

app
  .whenReady()
  .then(createWindow)
  .catch((error: unknown) => {
    console.error("Falha ao iniciar o aplicativo:", error);
    process.exitCode = 1;
    app.quit();
  });

app.on("window-all-closed", () => {
  app.quit();
});
