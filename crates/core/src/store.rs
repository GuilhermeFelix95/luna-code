//! Armazenamento local de projetos, conversas e mensagens em SQLite.
//!
//! O histórico pertence ao harness, não à CLI: qualquer adaptador pode
//! continuar uma conversa a partir dele.

use std::path::Path;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

/// Versão do esquema, gravada em `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 1;

const SCHEMA_V1: &str = "
CREATE TABLE projects (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE
);
CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE messages (
    id              INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    cli             TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE cli_sessions (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    cli             TEXT NOT NULL,
    external_id     TEXT NOT NULL,
    PRIMARY KEY (conversation_id, cli)
);
";

/// Quem escreveu a mensagem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "user" => Ok(Role::User),
            "assistant" => Ok(Role::Assistant),
            outro => bail!("papel desconhecido no banco: {outro}"),
        }
    }
}

/// Mensagem guardada numa conversa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub role: Role,
    /// CLI que recebeu ou produziu a mensagem.
    pub cli: String,
    pub content: String,
}

/// Conexão com o banco do harness.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Abre (ou cria) o banco em `path` e aplica as migrações pendentes.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("abrindo o banco em {}", path.display()))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let mut store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<()> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            bail!("banco com esquema {version}, mais novo que o suportado ({SCHEMA_VERSION})");
        }
        if version < SCHEMA_VERSION {
            let tx: Transaction = self.conn.transaction()?;
            tx.execute_batch(SCHEMA_V1)?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
            tx.commit()?;
        }
        Ok(())
    }

    /// Cadastra um projeto pelo caminho dele e devolve o id.
    pub fn create_project(&self, name: &str, path: &str) -> Result<i64> {
        if name.trim().is_empty() || path.trim().is_empty() {
            bail!("nome e caminho do projeto não podem ser vazios");
        }
        self.conn.execute(
            "INSERT INTO projects (name, path) VALUES (?1, ?2)",
            params![name, path],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Cria uma conversa dentro de um projeto e devolve o id.
    pub fn create_conversation(&self, project_id: i64) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO conversations (project_id) VALUES (?1)",
            params![project_id],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Acrescenta uma mensagem à conversa. Mensagens nunca são editadas.
    pub fn append_message(
        &self,
        conversation_id: i64,
        role: Role,
        cli: &str,
        content: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO messages (conversation_id, role, cli, content) VALUES (?1, ?2, ?3, ?4)",
            params![conversation_id, role.as_str(), cli, content],
        )?;
        Ok(())
    }

    /// Lista as mensagens da conversa na ordem em que foram gravadas.
    pub fn messages(&self, conversation_id: i64) -> Result<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "SELECT role, cli, content FROM messages WHERE conversation_id = ?1 ORDER BY id",
        )?;
        let linhas = stmt.query_map(params![conversation_id], |row| {
            let role: String = row.get(0)?;
            let cli: String = row.get(1)?;
            let content: String = row.get(2)?;
            Ok((role, cli, content))
        })?;
        linhas
            .map(|linha| {
                let (role, cli, content) = linha?;
                Ok(Message {
                    role: Role::parse(&role)?,
                    cli,
                    content,
                })
            })
            .collect()
    }

    /// Id da sessão que a CLI `cli` usa nesta conversa, se já existir.
    pub fn cli_session(&self, conversation_id: i64, cli: &str) -> Result<Option<String>> {
        let id = self
            .conn
            .query_row(
                "SELECT external_id FROM cli_sessions WHERE conversation_id = ?1 AND cli = ?2",
                params![conversation_id, cli],
                |row| row.get(0),
            )
            .optional()?;
        Ok(id)
    }

    /// Guarda (ou troca) o id da sessão da CLI `cli` nesta conversa.
    pub fn set_cli_session(
        &self,
        conversation_id: i64,
        cli: &str,
        external_id: &str,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO cli_sessions (conversation_id, cli, external_id) VALUES (?1, ?2, ?3)
             ON CONFLICT (conversation_id, cli) DO UPDATE SET external_id = excluded.external_id",
            params![conversation_id, cli, external_id],
        )?;
        Ok(())
    }
}
