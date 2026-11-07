//! Contrato comum dos adaptadores de CLI de agente.

use anyhow::Result;

/// Resposta de um turno, extraída da saída estruturada da CLI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    /// Identificador da sessão na CLI, usado para retomar no próximo turno.
    pub session_id: String,
    /// Texto final da resposta do assistente.
    pub reply: String,
}

/// Envia um turno para uma CLI de agente e devolve a resposta completa.
pub trait CliAdapter {
    /// Nome estável da CLI, gravado no store (ex.: `claude`).
    fn name(&self) -> &'static str;

    /// Envia `prompt`. Com `session_id`, retoma a sessão existente na CLI.
    fn send(&self, session_id: Option<&str>, prompt: &str) -> Result<Turn>;
}
