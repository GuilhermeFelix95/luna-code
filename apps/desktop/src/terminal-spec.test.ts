import { describe, expect, it } from "vitest";
import { buildProcessSpec } from "./terminal-spec";

const paths = {
  claudeProfileDir: "C:\\Users\\guilh\\AppData\\Roaming\\luna-code\\claude",
  homeDir: "C:\\Users\\guilh",
};

describe("buildProcessSpec", () => {
  it("shell usa o shell padrão do sidecar, sem programa nem ambiente", () => {
    expect(buildProcessSpec("shell", paths)).toEqual({});
  });

  it("claude roda o CLI com CLAUDE_CONFIG_DIR apontando para o perfil", () => {
    expect(buildProcessSpec("claude", paths)).toEqual({
      program: "claude",
      cwd: paths.homeDir,
      env: { CLAUDE_CONFIG_DIR: paths.claudeProfileDir },
    });
  });
});
