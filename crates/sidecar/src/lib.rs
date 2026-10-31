//! Protocolo do sidecar: uma requisição JSON por linha e uma resposta por linha.
//! Eventos de terminal (`pty.output`, `pty.exit`) são linhas extras, sem `id`.

mod pty;

use std::sync::mpsc::Sender;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use pty::PtySessions;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const METHOD_PING: &str = "ping";
const METHOD_PTY_SPAWN: &str = "pty.spawn";
const METHOD_PTY_WRITE: &str = "pty.write";
const METHOD_PTY_RESIZE: &str = "pty.resize";
const METHOD_PTY_KILL: &str = "pty.kill";
const RESULT_PONG: &str = "pong";
const MAX_COLS: u16 = 1000;
const MAX_ROWS: u16 = 500;
const MAX_WRITE_BYTES: usize = 64 * 1024;

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct Response {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnParams {
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteParams {
    session_id: u64,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeParams {
    session_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionParams {
    session_id: u64,
}

pub struct Sidecar {
    sessions: PtySessions,
}

impl Sidecar {
    /// `events` recebe as linhas de evento; o chamador decide como escrevê-las.
    pub fn new(events: Sender<String>) -> Self {
        Self {
            sessions: PtySessions::new(events),
        }
    }

    /// Processa uma linha de entrada e devolve a linha de resposta, sem o `\n` final.
    pub fn handle_line(&mut self, line: &str) -> String {
        let response = match serde_json::from_str::<Request>(line) {
            Ok(request) => self.handle_request(request),
            Err(error) => error_response(None, format!("requisição inválida: {error}")),
        };

        // Serializar uma struct com campos simples não falha; o erro seria um bug.
        serde_json::to_string(&response).expect("resposta do sidecar é sempre serializável")
    }

    /// Encerra todos os terminais abertos.
    pub fn shutdown(&mut self) {
        self.sessions.kill_all();
    }

    fn handle_request(&mut self, request: Request) -> Response {
        let id = request.id;
        match self.dispatch(&request.method, request.params) {
            Ok(result) => Response {
                id: Some(id),
                result: Some(result),
                error: None,
            },
            Err(message) => error_response(Some(id), message),
        }
    }

    fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            METHOD_PING => Ok(json!(RESULT_PONG)),
            METHOD_PTY_SPAWN => {
                let params: SpawnParams = parse_params(params)?;
                check_size(params.cols, params.rows)?;
                let id = self
                    .sessions
                    .spawn(pty::default_shell(), params.cols, params.rows)?;
                Ok(json!({ "sessionId": id }))
            }
            METHOD_PTY_WRITE => {
                let params: WriteParams = parse_params(params)?;
                let bytes = STANDARD
                    .decode(&params.data)
                    .map_err(|error| format!("dados base64 inválidos: {error}"))?;
                if bytes.len() > MAX_WRITE_BYTES {
                    return Err(format!(
                        "escrita maior que o limite de {MAX_WRITE_BYTES} bytes"
                    ));
                }
                self.sessions.write(params.session_id, &bytes)?;
                Ok(Value::Null)
            }
            METHOD_PTY_RESIZE => {
                let params: ResizeParams = parse_params(params)?;
                check_size(params.cols, params.rows)?;
                self.sessions
                    .resize(params.session_id, params.cols, params.rows)?;
                Ok(Value::Null)
            }
            METHOD_PTY_KILL => {
                let params: SessionParams = parse_params(params)?;
                self.sessions.kill(params.session_id)?;
                Ok(Value::Null)
            }
            other => Err(format!("método desconhecido: {other}")),
        }
    }
}

fn parse_params<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| format!("parâmetros inválidos: {error}"))
}

fn check_size(cols: u16, rows: u16) -> Result<(), String> {
    if cols == 0 || cols > MAX_COLS || rows == 0 || rows > MAX_ROWS {
        return Err(format!(
            "tamanho inválido: colunas entre 1 e {MAX_COLS}, linhas entre 1 e {MAX_ROWS}"
        ));
    }
    Ok(())
}

fn error_response(id: Option<u64>, message: String) -> Response {
    Response {
        id,
        result: None,
        error: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::Sidecar;
    use serde_json::{Value, json};

    fn sidecar() -> Sidecar {
        let (tx, _rx) = mpsc::channel();
        Sidecar::new(tx)
    }

    fn parse(sidecar: &mut Sidecar, line: &str) -> Value {
        serde_json::from_str(&sidecar.handle_line(line)).expect("resposta é JSON válido")
    }

    #[test]
    fn ping_responde_pong_com_o_mesmo_id() {
        let response = parse(&mut sidecar(), r#"{"id":7,"method":"ping"}"#);

        assert_eq!(response, json!({"id": 7, "result": "pong", "error": null}));
    }

    #[test]
    fn metodo_desconhecido_retorna_erro_com_o_id() {
        let response = parse(&mut sidecar(), r#"{"id":3,"method":"nao-existe"}"#);

        assert_eq!(response["id"], json!(3));
        assert_eq!(response["result"], Value::Null);
        assert_eq!(response["error"], json!("método desconhecido: nao-existe"));
    }

    #[test]
    fn json_invalido_retorna_erro_sem_id() {
        let response = parse(&mut sidecar(), "isto não é json");

        assert_eq!(response["id"], Value::Null);
        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .starts_with("requisição inválida:")
        );
    }

    #[test]
    fn requisicao_sem_id_e_erro_sem_id() {
        let response = parse(&mut sidecar(), r#"{"method":"ping"}"#);

        assert_eq!(response["id"], Value::Null);
        assert!(response["error"].is_string());
    }

    #[test]
    fn spawn_rejeita_tamanho_zero_sem_criar_processo() {
        let response = parse(
            &mut sidecar(),
            r#"{"id":1,"method":"pty.spawn","params":{"cols":0,"rows":24}}"#,
        );

        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .starts_with("tamanho inválido")
        );
    }

    #[test]
    fn write_rejeita_base64_invalido() {
        let response = parse(
            &mut sidecar(),
            r#"{"id":2,"method":"pty.write","params":{"sessionId":1,"data":"%%%"}}"#,
        );

        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .starts_with("dados base64 inválidos")
        );
    }

    #[test]
    fn params_ausentes_retornam_erro_de_parametros() {
        let response = parse(&mut sidecar(), r#"{"id":4,"method":"pty.kill"}"#);

        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .starts_with("parâmetros inválidos")
        );
    }
}
