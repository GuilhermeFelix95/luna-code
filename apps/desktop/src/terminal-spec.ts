// Traduz o tipo de sessão pedido pelo renderer no programa e no ambiente do sidecar.
// Fica fora do Electron para poder ser testado em Node puro.

import type { ProcessSpec } from "./sidecar-client";
import type { TerminalKind } from "./terminal-api";

export interface TerminalSpecPaths {
  /** Pasta do perfil do Claude Code. Vira `CLAUDE_CONFIG_DIR` na sessão. */
  claudeProfileDir: string;
  /**
   * Pasta onde o Claude roda. Não pode ser a pasta pessoal: o Claude não grava a
   * confiança da pasta do usuário, então o diálogo voltaria em toda sessão.
   */
  workspaceDir: string;
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
        cwd: paths.workspaceDir,
        env: { CLAUDE_CONFIG_DIR: paths.claudeProfileDir },
      };
  }
}
