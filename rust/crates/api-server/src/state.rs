use api::{OpenAiCompatClient, OpenAiCompatConfig};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use runtime::PermissionPromptDecision;
use crate::sandbox_client::OpenSandboxClient;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub qwen_client: OpenAiCompatClient,
    pub sandbox_client: OpenSandboxClient,
    pub pending_actions: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionPromptDecision>>>>,
}

impl AppState {
    pub fn new(db: sqlx::SqlitePool) -> Self {
        // 由于是本地兼容模型，API Key 可以随便填一个 placeholder
        let api_key = std::env::var("QWEN_API_KEY").unwrap_or_else(|_| "sk-local-qwen".to_string());
        
        // 1. 初始化一个针对本地 Qwen 的 OpenAI 兼容客户端
        let qwen_client = OpenAiCompatClient::new(api_key, OpenAiCompatConfig::openai())
            .with_base_url("http://10.50.70.91:8000/v1"); // 对接本地大模型

        let sandbox_client = OpenSandboxClient::new();

        Self {
            db,
            qwen_client,
            sandbox_client,
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
