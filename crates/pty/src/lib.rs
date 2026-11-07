//! Sessão de terminal (ConPTY no Windows) que roda uma CLI de agente.
//!
//! A CLI roda numa TUI real. O harness envia teclas por `PtySession::send`
//! e lê a saída por `PtyOutput::read_chunk`.

use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use portable_pty::{Child, CommandBuilder, MasterPty, native_pty_system};
pub use portable_pty::{ExitStatus, PtySize};

/// Consulta de posição do cursor que o ConPTY envia antes de seguir.
const CURSOR_QUERY: &[u8] = b"\x1b[6n";
/// Resposta do terminal: cursor na linha 1, coluna 1.
const CURSOR_REPLY: &[u8] = b"\x1b[1;1R";
/// Bytes finais de uma leitura que podem ser o início de uma consulta cortada.
const CARRY: usize = CURSOR_QUERY.len() - 1;

type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

/// Controle da sessão: envio de entrada, redimensionamento e espera pelo processo.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: SharedWriter,
}

/// Leitor da saída. Deve ir para uma thread própria: o ConPTY não envia EOF
/// quando o processo termina.
pub struct PtyOutput {
    reader: Box<dyn Read + Send>,
    writer: SharedWriter,
    carry: Vec<u8>,
}

impl PtySession {
    /// Abre um PTY e inicia `program` com `args`.
    pub fn spawn(program: &str, args: &[&str], size: PtySize) -> Result<(Self, PtyOutput)> {
        let pair = native_pty_system().openpty(size)?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer: SharedWriter = Arc::new(Mutex::new(pair.master.take_writer()?));
        let session = Self {
            master: pair.master,
            child,
            writer: Arc::clone(&writer),
        };
        let output = PtyOutput {
            reader,
            writer,
            carry: Vec::new(),
        };
        Ok((session, output))
    }

    /// Envia bytes para a entrada da CLI (texto, teclas, `\r` para Enter).
    pub fn send(&self, bytes: &[u8]) -> io::Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| io::Error::other("escritor do PTY envenenado"))?;
        writer.write_all(bytes)?;
        writer.flush()
    }

    /// Redimensiona o terminal virtual.
    pub fn resize(&self, size: PtySize) -> Result<()> {
        self.master.resize(size)?;
        Ok(())
    }

    /// Devolve o status se o processo já terminou, sem bloquear.
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    /// Espera o processo terminar.
    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait()
    }
}

impl PtyOutput {
    /// Lê a próxima parte da saída e responde às consultas de cursor.
    /// Devolve `Ok(0)` quando o PTY fecha.
    pub fn read_chunk(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.reader.read(buf)?;
        if n == 0 {
            return Ok(0);
        }

        let mut data = std::mem::take(&mut self.carry);
        data.extend_from_slice(&buf[..n]);

        let queries = data
            .windows(CURSOR_QUERY.len())
            .filter(|janela| *janela == CURSOR_QUERY)
            .count();
        if queries > 0 {
            let mut writer = self
                .writer
                .lock()
                .map_err(|_| io::Error::other("escritor do PTY envenenado"))?;
            for _ in 0..queries {
                writer.write_all(CURSOR_REPLY)?;
            }
            writer.flush()?;
        }

        self.carry = data[data.len().saturating_sub(CARRY)..].to_vec();
        Ok(n)
    }
}
