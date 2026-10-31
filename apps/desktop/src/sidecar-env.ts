// Ambiente que o sidecar e os terminais herdam. Sem as variáveis CLAUDE_* de quem
// iniciou o app: elas identificam uma sessão do Claude Code pai e desligam a gravação
// de configuração e transcrições do Claude filho.

export function sidecarEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || name.toUpperCase().startsWith("CLAUDE")) {
      continue;
    }
    env[name] = value;
  }
  return env;
}
