//! Protocolo do sidecar: uma requisição JSON por linha, uma resposta JSON por linha.

use serde::{Deserialize, Serialize};

const METHOD_PING: &str = "ping";
const RESULT_PONG: &str = "pong";

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
}

#[derive(Serialize)]
struct Response {
    id: Option<u64>,
    result: Option<String>,
    error: Option<String>,
}

/// Processa uma linha de entrada e devolve a linha de resposta, sem o `\n` final.
pub fn handle_line(line: &str) -> String {
    let response = match serde_json::from_str::<Request>(line) {
        Ok(request) => handle_request(request),
        Err(error) => Response {
            id: None,
            result: None,
            error: Some(format!("requisição inválida: {error}")),
        },
    };

    // Serializar uma struct com campos simples não falha; o erro seria um bug.
    serde_json::to_string(&response).expect("resposta do sidecar é sempre serializável")
}

fn handle_request(request: Request) -> Response {
    match request.method.as_str() {
        METHOD_PING => Response {
            id: Some(request.id),
            result: Some(RESULT_PONG.to_owned()),
            error: None,
        },
        other => Response {
            id: Some(request.id),
            result: None,
            error: Some(format!("método desconhecido: {other}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::handle_line;
    use serde_json::{Value, json};

    fn parse(line: &str) -> Value {
        serde_json::from_str(&handle_line(line)).expect("resposta é JSON válido")
    }

    #[test]
    fn ping_responde_pong_com_o_mesmo_id() {
        let response = parse(r#"{"id":7,"method":"ping"}"#);

        assert_eq!(response, json!({"id": 7, "result": "pong", "error": null}));
    }

    #[test]
    fn metodo_desconhecido_retorna_erro_com_o_id() {
        let response = parse(r#"{"id":3,"method":"nao-existe"}"#);

        assert_eq!(response["id"], json!(3));
        assert_eq!(response["result"], Value::Null);
        assert_eq!(response["error"], json!("método desconhecido: nao-existe"));
    }

    #[test]
    fn json_invalido_retorna_erro_sem_id() {
        let response = parse("isto não é json");

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
        let response = parse(r#"{"method":"ping"}"#);

        assert_eq!(response["id"], Value::Null);
        assert!(response["error"].is_string());
    }
}
