import { describe, expect, it } from "vitest";
import { createMainWindowOptions } from "./window-options";

describe("createMainWindowOptions", () => {
  it("ativa isolamento de contexto e sandbox e desativa nodeIntegration", () => {
    const { webPreferences } = createMainWindowOptions("/caminho/preload.js");

    expect(webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });

  it("aponta o preload para o caminho informado", () => {
    const { webPreferences } = createMainWindowOptions("/caminho/preload.js");

    expect(webPreferences).toMatchObject({ preload: "/caminho/preload.js" });
  });
});
