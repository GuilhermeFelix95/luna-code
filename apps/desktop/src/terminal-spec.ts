// Traduz o tipo de sessão pedido pelo renderer no programa e no ambiente do sidecar.
// Fica fora do Electron para poder ser testado em Node puro.

import type { ProcessSpec } from "./sidecar-client";
import type { TerminalKind } from "./terminal-api";

export interface TerminalSpecPaths {
  /** Pasta do perfil do Claude Code. Vira `CLAUDE_CONFIG_DIR` na sessão. */
  claudeProfileDir: string;
  /** Pasta onde a sessão começa. */
  homeDir: string;
}

export function buildProcessSpec(
  kind: TerminalKind,
  paths: TerminalSpecPaths,
): ProcessSpec {
  switch (kind) {
    case "shell":
      return {};
    case "claude":
      return {
        program: "claude",
        cwd: paths.homeDir,
        env: { CLAUDE_CONFIG_DIR: paths.claudeProfileDir },
      };
  }
}
