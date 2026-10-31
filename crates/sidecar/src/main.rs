use std::io::{self, BufRead, Write};

use luna_sidecar::handle_line;

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = line?;
        writeln!(stdout, "{}", handle_line(&line))?;
        stdout.flush()?;
    }

    Ok(())
}
