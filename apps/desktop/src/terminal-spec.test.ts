import { describe, expect, it } from "vitest";
import { buildProcessSpec } from "./terminal-spec";

const paths = {
  claudeProfileDir: "C:\\Users\\guilh\\AppData\\Roaming\\luna-code\\claude",
  workspaceDir: "C:\\Users\\guilh\\AppData\\Roaming\\luna-code\\workspace",
};

describe("buildProcessSpec", () => {
  it("shell usa o shell padrão do sidecar, sem programa nem ambiente", () => {
    expect(buildProcessSpec("shell", paths)).toEqual({});
  });

  it("claude roda o CLI com CLAUDE_CONFIG_DIR e na pasta de trabalho do app", () => {
    expect(buildProcessSpec("claude", paths)).toEqual({
      program: "claude",
      cwd: paths.workspaceDir,
      env: { CLAUDE_CONFIG_DIR: paths.claudeProfileDir },
    });
  });
});
