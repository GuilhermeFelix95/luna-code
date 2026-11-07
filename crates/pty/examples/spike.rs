//! Spike: abre `cmd.exe` no ConPTY, envia um comando, mostra a saída e encerra.
//!
//! Rodar com: `cargo run -p luna-pty --example spike`

use std::io::{self, Write};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use luna_pty::{PtySession, PtySize};

const SIZE: PtySize = PtySize {
    rows: 30,
    cols: 120,
    pixel_width: 0,
    pixel_height: 0,
};
const JANELA_DE_LEITURA: Duration = Duration::from_secs(2);

fn main() -> Result<()> {
    let (mut session, mut output) = PtySession::spawn("cmd.exe", &[], SIZE)?;

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match output.read_chunk(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(erro) => {
                    eprintln!("erro na leitura do PTY: {erro}");
                    break;
                }
            }
        }
    });

    session.send(b"echo teste-pty\r\n")?;
    drenar(&rx, JANELA_DE_LEITURA)?;

    session.send(b"exit\r\n")?;
    let status = session.wait()?;
    println!("\ncódigo de saída: {}", status.exit_code());
    Ok(())
}

fn drenar(rx: &mpsc::Receiver<Vec<u8>>, janela: Duration) -> io::Result<()> {
    let fim = Instant::now() + janela;
    let stdout = io::stdout();
    let mut out = stdout.lock();
    while let Some(restante) = fim.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(restante) {
            Ok(bytes) => {
                out.write_all(&bytes)?;
                out.flush()?;
            }
            Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}
