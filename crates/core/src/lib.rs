//! Núcleo do harness: adaptadores por CLI de agente.
//!
//! Por enquanto: adaptador do Claude Code. Sessões e handoff ainda não existem.

pub mod adapter;
pub mod claude;

pub use adapter::{CliAdapter, Turn};
pub use claude::ClaudeAdapter;
