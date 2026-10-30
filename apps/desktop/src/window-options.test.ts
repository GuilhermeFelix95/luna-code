import { describe, expect, it } from "vitest";
import { createMainWindowOptions } from "./window-options";

describe("createMainWindowOptions", () => {
  it("ativa isolamento de contexto e sandbox e desativa nodeIntegration", () => {
    const { webPreferences } = createMainWindowOptions();

    expect(webPreferences).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});
