# CLAUDE.md

## Projeto

Harness desktop com licença Apache-2.0, em monorepo pnpm. Casca em Electron; sidecar em Rust previsto para a etapa 2.

- Node 24.x (LTS)
- pnpm 12.15.0 (`packageManager` no `package.json`)
- Electron 44.7.2 (versão exata, sem `^`)
- TypeScript 6.0.3 (exato)
- Vitest 5.0.5
- ESLint 10.13.0 com typescript-eslint 8.72.1
- Prettier 3.9.10
- Rust 1.99.1 (fixado em `rust-toolchain.toml`), crate `luna-sidecar` em `crates/sidecar`

## Comandos

- Instalar: `pnpm install`
- Teste de um arquivo: `pnpm --filter @luna-code/desktop exec vitest run <caminho-do-arquivo>`
- Suíte completa (somente quando eu pedir): `pnpm test`
- Lint de arquivos: `pnpm exec eslint <caminhos>`
- Formatação: `pnpm exec prettier --check <caminhos>`
- Tipos: `pnpm --filter @luna-code/desktop exec tsc -p tsconfig.json --noEmit`
- Build (main, renderer e preload): `pnpm --filter @luna-code/desktop run build`
- Tipos do renderer: `pnpm --filter @luna-code/desktop run typecheck`
- Abrir a aplicação: `pnpm --filter @luna-code/desktop start`
- Build do sidecar (obrigatório antes de `start`): `cargo build -p luna-sidecar`
- Testes do sidecar: `cargo test -p luna-sidecar`
- Clippy do sidecar: `cargo clippy -p luna-sidecar --all-targets -- -D warnings`
- Formatação do sidecar: `cargo fmt -p luna-sidecar -- --check`

## Armadilhas conhecidas

- typescript-eslint 8.72 não suporta TypeScript 7. Manter TypeScript 6 até o suporte chegar.
- pnpm 12 bloqueia scripts de build. O Electron só baixa o binário porque está aprovado em `allowBuilds` no `pnpm-workspace.yaml`. Não remover essa entrada.
- Os tipos do Electron não declaram `app.exitCode`. Usar `process.exitCode`.
- O ConPTY envia a consulta de cursor `ESC[6n` e espera a resposta do terminal antes de seguir. Quem renderiza (xterm.js) precisa responder; o teste do PTY responde por conta própria.
- O ConPTY não fecha a saída quando o processo termina. Por isso `pty.exit` sai da thread de espera, com uma janela de 500 ms para a saída pendente.
- O portable-pty 0.9.0 devolve erro no `kill` do Windows mesmo quando o `TerminateProcess` funciona (retorno invertido). O sidecar registra aviso no log e não falha a requisição.
- Sessões encerradas ficam no mapa até `pty.kill`. O cliente deve chamar `pty.kill` depois de receber `pty.exit`.
- Preload em modo sandbox só consegue `require` do módulo `electron`. Por isso `src/preload.ts` é empacotado num arquivo único (`vite.preload.mts`). Sem isso, a ponte `window.terminal` fica vazia sem erro aparente.
- O Electron carrega a página por `file://`. Script `type="module"` e `crossorigin` falham nesse protocolo. O `vite.config.mts` gera script clássico com `defer` e CSS como arquivo.
- O CSP `default-src 'self'` bloqueia `<style>` criado por JS. Por isso o CSS sai como arquivo, não embutido.
- `vite.config.mts` tem `root: "renderer-src"`, e o Vitest herda essa raiz. Os testes usam `vitest.config.mts`.
- O xterm.js responde sozinho à consulta de cursor `ESC[6n`, sem código extra no renderer (verificado no PowerShell real).
- O Electron procura o sidecar em `target/debug` (`apps/desktop/src/sidecar-path.ts`). Sem `cargo build` antes, o app inicia mas o ping falha.
- Só atualizar a versão do Electron em PR própria, com versão estável de pelo menos duas semanas.
