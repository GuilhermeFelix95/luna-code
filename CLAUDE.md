# CLAUDE.md

## Projeto

Harness em Rust que roda CLIs de agente (Claude Code, OpenCode, Codex) dentro de PTYs, sem perder contexto ao trocar de CLI. A GUI em GPUI será sobre as TUIs, que ficam ocultas do usuário.

- Rust **1.99.1**, fixado em `rust-toolchain.toml`. Edição **2024**, `resolver = "3"`.
- Workspace com três crates:
  - `crates/core` (`luna-core`): sessões, store de contexto e adaptadores por CLI. Ainda sem implementação.
  - `crates/pty` (`luna-pty`): sessões de terminal (ConPTY no Windows). Tem a sessão ConPTY e o spike.
  - `crates/ui` (`luna-ui`): interface GPUI. Ainda sem implementação.
- Dependências: `portable-pty = 0.9.0` (fixada com `=`) e `anyhow 1`, no crate `pty`.

## Comandos

- Verificar tipos: `cargo check --workspace`
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`
- Formatar: `cargo fmt --all`
- Testes de um arquivo ou teste: `cargo test -p <crate> <nome>`
- Spike de PTY (verificação manual, Windows): `cargo run -p luna-pty --example spike`
- Suíte completa: `cargo test --workspace` (somente quando eu pedir)

## Armadilhas conhecidas

- No crate `pty` (ConPTY): o processo filho envia `ESC[6n` e espera a resposta do terminal antes de renderizar. Sem responder, a TUI trava.
- No crate `pty` (ConPTY): o ConPTY não envia EOF quando o processo termina. O leitor deve rodar em thread própria, e a saída só é considerada encerrada após uma janela de cerca de 500 ms.
- Ao implementar sessões: sessões encerradas continuam no mapa até serem removidas com `kill`.
