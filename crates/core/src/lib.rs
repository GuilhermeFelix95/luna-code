//! Núcleo do harness: store de conversas e adaptadores por CLI.
//!
//! Por enquanto: store SQLite. Adaptadores de CLI e handoff ainda não existem.

pub mod store;

pub use store::{Message, Role, Store};
