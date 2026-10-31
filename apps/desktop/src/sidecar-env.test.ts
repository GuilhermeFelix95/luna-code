import { describe, expect, it } from "vitest";
import { sidecarEnv } from "./sidecar-env";

describe("sidecarEnv", () => {
  it("remove as variáveis CLAUDE_* herdadas de uma sessão do Claude Code", () => {
    const env = sidecarEnv({
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDECODE: "1",
      CLAUDE_CONFIG_DIR: "C:\\perfil-antigo",
      Claude_Code_Entrypoint: "cli",
      PATH: "C:\\Windows",
      USERPROFILE: "C:\\Users\\guilh",
    });

    expect(env).toEqual({
      PATH: "C:\\Windows",
      USERPROFILE: "C:\\Users\\guilh",
    });
  });

  it("não altera o ambiente original", () => {
    const original = { CLAUDECODE: "1", PATH: "C:\\Windows" };

    sidecarEnv(original);

    expect(original).toEqual({ CLAUDECODE: "1", PATH: "C:\\Windows" });
  });

  it("ignora valores indefinidos", () => {
    expect(sidecarEnv({ PATH: "C:\\Windows", VAZIA: undefined })).toEqual({
      PATH: "C:\\Windows",
    });
  });
});
