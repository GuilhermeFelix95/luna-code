//! Adaptador do Claude Code: um processo `claude -p` por turno, com saída `stream-json`.
//!
//! Não usa a TUI. O prompt vai pela entrada padrão, e a resposta vem como
//! eventos JSON, um por linha.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use anyhow::{Context, Result, bail};
use serde_json::Value;

use crate::adapter::{CliAdapter, Turn};

/// Executável no PATH.
const PROGRAM: &str = "claude";
/// Nome gravado no store.
const NAME: &str = "claude";

/// Adaptador do Claude Code para um projeto.
///
/// O `cwd` precisa ser sempre o mesmo do projeto: o Claude Code guarda as
/// sessões por diretório de trabalho.
pub struct ClaudeAdapter {
    cwd: PathBuf,
}

impl ClaudeAdapter {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }
}

impl CliAdapter for ClaudeAdapter {
    fn name(&self) -> &'static str {
        NAME
    }

    fn send(&self, session_id: Option<&str>, prompt: &str) -> Result<Turn> {
        let mut cmd = Command::new(PROGRAM);
        cmd.current_dir(&self.cwd)
            .args(["-p", "--output-format", "stream-json", "--verbose"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(id) = session_id {
            cmd.args(["--resume", id]);
        }

        let mut child = cmd.spawn().context("iniciando o claude")?;
        let mut stdin = child
            .stdin
            .take()
            .context("entrada do claude indisponível")?;
        stdin
            .write_all(prompt.as_bytes())
            .context("enviando o prompt ao claude")?;
        // Fecha a entrada para o claude começar a responder.
        drop(stdin);

        let output = child
            .wait_with_output()
            .context("aguardando o claude terminar")?;
        if !output.status.success() {
            bail!(
                "claude terminou com {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        extrair_turno(&output.stdout)
    }
}

/// Lê o evento `result` do fluxo `stream-json` e devolve a resposta do turno.
fn extrair_turno(saida: &[u8]) -> Result<Turn> {
    let texto = std::str::from_utf8(saida).context("saída do claude não é UTF-8")?;
    for linha in texto.lines().filter(|linha| !linha.trim().is_empty()) {
        let evento: Value =
            serde_json::from_str(linha).context("linha inválida na saída do claude")?;
        if evento.get("type").and_then(Value::as_str) != Some("result") {
            continue;
        }
        let is_error = evento
            .get("is_error")
            .and_then(Value::as_bool)
            .context("evento result sem o campo is_error")?;
        if is_error {
            let subtype = evento
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("desconhecido");
            bail!("claude retornou erro (subtype: {subtype})");
        }
        return Ok(Turn {
            session_id: campo_texto(&evento, "session_id")?,
            reply: campo_texto(&evento, "result")?,
        });
    }
    bail!("saída do claude sem evento result")
}

fn campo_texto(evento: &Value, campo: &str) -> Result<String> {
    evento
        .get(campo)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .with_context(|| format!("evento result sem o campo {campo}"))
}
