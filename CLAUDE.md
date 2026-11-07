# CLAUDE.md

## Projeto

Harness em Rust que roda CLIs de agente (Claude Code, OpenCode, Codex) dentro de PTYs, sem perder contexto ao trocar de CLI. A GUI em GPUI ainda não existe; a interface do usuário será sobre as TUIs, que ficam ocultas.

- Rust **1.99.1**, fixado em `rust-toolchain.toml`. Edição **2024**, `resolver = "3"`.
- Dependências: `portable-pty = 0.9.0` (fixada com `=`), `anyhow 1`.
- Workspace com um crate: `crates/pty` (pacote `luna-pty`). Os crates `core` e `ui` ainda não existem.

## Comandos

- Instalar dependências: `cargo fetch`
- Verificar tipos: `cargo check -p luna-pty`
- Lint: `cargo clippy -p luna-pty --all-targets -- -D warnings`
- Formatar: `cargo fmt -p luna-pty`
- Testes de um arquivo ou teste: `cargo test -p luna-pty <nome>`
- Spike de PTY (verificação manual, Windows): `cargo run -p luna-pty --example spike`
- Suíte completa: `cargo test --workspace` (somente quando eu pedir)

## Armadilhas conhecidas

- O ConPTY não envia EOF quando o processo termina. Por isso o leitor roda em thread própria e a saída só é considerada encerrada após uma janela de cerca de 500 ms.
- Sessões encerradas continuam no mapa de sessões até serem removidas com `kill`. Isso vale para o gerenciador de sessões quando ele existir.
