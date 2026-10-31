//! Sessões de pseudo-terminal. Cada sessão tem uma thread que envia a saída como eventos.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use portable_pty::{
    Child, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize, native_pty_system,
};
use serde_json::json;

const READ_BUFFER_BYTES: usize = 8 * 1024;
const EXIT_OUTPUT_GRACE: Duration = Duration::from_millis(500);
const EVENT_OUTPUT: &str = "pty.output";
const EVENT_EXIT: &str = "pty.exit";

/// Shell padrão da plataforma, usado quando a requisição não informa `program`.
pub fn default_shell() -> CommandBuilder {
    if cfg!(windows) {
        CommandBuilder::new("powershell.exe")
    } else {
        CommandBuilder::new("/bin/sh")
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct PtySessions {
    next_id: u64,
    sessions: HashMap<u64, Session>,
    events: Sender<String>,
}

impl PtySessions {
    pub fn new(events: Sender<String>) -> Self {
        Self {
            next_id: 1,
            sessions: HashMap::new(),
            events,
        }
    }

    pub fn spawn(&mut self, command: CommandBuilder, cols: u16, rows: u16) -> Result<u64, String> {
        let PtyPair { master, slave } = native_pty_system()
            .openpty(pty_size(cols, rows))
            .map_err(|error| format!("falha ao criar terminal: {error}"))?;
        let child = slave
            .spawn_command(command)
            .map_err(|error| format!("falha ao iniciar processo: {error}"))?;
        // O lado escravo só é necessário para iniciar o processo.
        drop(slave);

        let reader = master
            .try_clone_reader()
            .map_err(|error| format!("falha ao ler o terminal: {error}"))?;
        let writer = master
            .take_writer()
            .map_err(|error| format!("falha ao escrever no terminal: {error}"))?;
        let killer = child.clone_killer();

        let id = self.next_id;
        self.next_id += 1;

        // O ConPTY não fecha a saída quando o processo termina, então a leitura
        // e a espera do processo ficam em threads separadas.
        let (output_done_tx, output_done_rx) = mpsc::channel::<()>();
        let output_events = self.events.clone();
        std::thread::spawn(move || {
            pump_output(id, reader, output_events);
            // Se o receptor já saiu, ninguém espera pelo fim da saída.
            let _ = output_done_tx.send(());
        });
        let exit_events = self.events.clone();
        std::thread::spawn(move || notify_exit(id, child, output_done_rx, exit_events));

        self.sessions.insert(
            id,
            Session {
                master,
                writer,
                killer,
            },
        );
        Ok(id)
    }

    pub fn write(&mut self, id: u64, bytes: &[u8]) -> Result<(), String> {
        let session = self.session_mut(id)?;
        session
            .writer
            .write_all(bytes)
            .map_err(|error| format!("falha ao escrever no terminal: {error}"))?;
        session
            .writer
            .flush()
            .map_err(|error| format!("falha ao escrever no terminal: {error}"))
    }

    pub fn resize(&mut self, id: u64, cols: u16, rows: u16) -> Result<(), String> {
        self.session_mut(id)?
            .master
            .resize(pty_size(cols, rows))
            .map_err(|error| format!("falha ao redimensionar terminal: {error}"))
    }

    /// Encerra o processo e remove a sessão do mapa. O término real é confirmado pelo
    /// evento `pty.exit`. No Windows, o portable-pty 0.9.0 devolve erro mesmo quando o
    /// `TerminateProcess` funciona (o retorno é invertido), então o erro vira aviso no log.
    pub fn kill(&mut self, id: u64) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(&id)
            .ok_or_else(|| format!("sessão desconhecida: {id}"))?;
        if let Err(error) = session.killer.kill() {
            eprintln!("aviso ao encerrar sessão {id}: {error}");
        }
        Ok(())
    }

    pub fn kill_all(&mut self) {
        for (id, mut session) in self.sessions.drain() {
            if let Err(error) = session.killer.kill() {
                eprintln!("falha ao encerrar sessão {id}: {error}");
            }
        }
    }

    fn session_mut(&mut self, id: u64) -> Result<&mut Session, String> {
        self.sessions
            .get_mut(&id)
            .ok_or_else(|| format!("sessão desconhecida: {id}"))
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn pump_output(id: u64, mut reader: Box<dyn Read + Send>, events: Sender<String>) {
    let mut buffer = [0u8; READ_BUFFER_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let data = STANDARD.encode(&buffer[..read]);
                let event = json!({"event": EVENT_OUTPUT, "sessionId": id, "data": data});
                if events.send(event.to_string()).is_err() {
                    return;
                }
            }
            Err(error) => {
                eprintln!("erro ao ler terminal {id}: {error}");
                break;
            }
        }
    }
}

fn notify_exit(
    id: u64,
    mut child: Box<dyn Child + Send + Sync>,
    output_done: Receiver<()>,
    events: Sender<String>,
) {
    let code = match child.wait() {
        Ok(status) => Some(status.exit_code()),
        Err(error) => {
            eprintln!("erro ao aguardar processo {id}: {error}");
            None
        }
    };

    // Dá tempo para a saída que ainda está no pipe chegar antes do código de saída.
    // Timeout ou desconexão são aceitos: a saída pode não terminar nunca.
    let _ = output_done.recv_timeout(EXIT_OUTPUT_GRACE);

    let event = json!({"event": EVENT_EXIT, "sessionId": id, "code": code});
    // Receptor fechado significa que o sidecar está encerrando; não há o que notificar.
    let _ = events.send(event.to_string());
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    const TIMEOUT: Duration = Duration::from_secs(10);
    const CURSOR_POSITION_QUERY: &str = "\u{1b}[6n";
    const CURSOR_POSITION_REPLY: &[u8] = b"\x1b[1;1R";

    fn echo_command(text: &str) -> CommandBuilder {
        if cfg!(windows) {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/C", "echo", text]);
            command
        } else {
            let mut command = CommandBuilder::new("/bin/sh");
            command.args(["-c", &format!("echo {text}")]);
            command
        }
    }

    #[test]
    fn saida_do_processo_chega_como_evento_e_depois_o_codigo_de_saida() {
        let (tx, rx) = mpsc::channel();
        let mut sessions = PtySessions::new(tx);
        let id = sessions
            .spawn(echo_command("luna-pty"), 80, 24)
            .expect("spawn deve funcionar");

        let mut output = String::new();
        let mut answered_cursor_query = false;
        loop {
            let event: serde_json::Value =
                serde_json::from_str(&rx.recv_timeout(TIMEOUT).expect("evento esperado"))
                    .expect("evento é JSON");
            match event["event"].as_str() {
                Some(EVENT_OUTPUT) => {
                    let bytes = STANDARD
                        .decode(event["data"].as_str().expect("data é string"))
                        .expect("data é base64");
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    // O ConPTY espera a resposta do terminal à consulta de cursor (ESC[6n)
                    // antes de continuar. Em produção quem responde é o xterm.js.
                    if !answered_cursor_query && output.contains(CURSOR_POSITION_QUERY) {
                        sessions
                            .write(id, CURSOR_POSITION_REPLY)
                            .expect("resposta ao cursor deve ser aceita");
                        answered_cursor_query = true;
                    }
                }
                Some(EVENT_EXIT) => {
                    assert_eq!(event["code"], 0);
                    break;
                }
                other => panic!("evento inesperado: {other:?}"),
            }
        }

        assert!(output.contains("luna-pty"), "saída foi: {output:?}");
    }

    fn long_running_command() -> CommandBuilder {
        if cfg!(windows) {
            let mut command = CommandBuilder::new("cmd.exe");
            command.args(["/C", "ping", "-n", "30", "127.0.0.1"]);
            command
        } else {
            let mut command = CommandBuilder::new("/bin/sh");
            command.args(["-c", "sleep 30"]);
            command
        }
    }

    #[test]
    fn kill_encerra_o_processo_e_emite_pty_exit() {
        let (tx, rx) = mpsc::channel();
        let mut sessions = PtySessions::new(tx);
        let id = sessions
            .spawn(long_running_command(), 80, 24)
            .expect("spawn deve funcionar");

        sessions.kill(id).expect("kill deve aceitar a sessão");

        loop {
            let event: serde_json::Value =
                serde_json::from_str(&rx.recv_timeout(TIMEOUT).expect("pty.exit esperado"))
                    .expect("evento é JSON");
            if event["event"] == EVENT_EXIT {
                assert_eq!(event["sessionId"], id);
                break;
            }
        }
    }

    #[test]
    fn sessao_desconhecida_retorna_erro() {
        let (tx, _rx) = mpsc::channel();
        let mut sessions = PtySessions::new(tx);

        assert!(sessions.write(99, b"x").is_err());
        assert!(sessions.resize(99, 80, 24).is_err());
        assert!(sessions.kill(99).is_err());
    }
}
