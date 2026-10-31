use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::thread;

use luna_sidecar::Sidecar;

fn main() -> io::Result<()> {
    // Uma única thread escreve no stdout; respostas e eventos chegam por canal.
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        for line in rx {
            if let Err(error) = writeln!(stdout, "{line}").and_then(|()| stdout.flush()) {
                eprintln!("falha ao escrever no stdout: {error}");
                return;
            }
        }
    });

    let mut sidecar = Sidecar::new(tx.clone());
    for line in io::stdin().lock().lines() {
        let response = sidecar.handle_line(&line?);
        if tx.send(response).is_err() {
            sidecar.shutdown();
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "escritor do stdout encerrou",
            ));
        }
    }

    sidecar.shutdown();
    Ok(())
}
