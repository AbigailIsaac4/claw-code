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
        let api_key = std::env::var("OPENAI_API_KEY").or_else(|_| std::env::var("QWEN_API_KEY")).unwrap_or_else(|_| "sk-local-qwen".to_string());
        let base_url = std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "http://10.50.70.91:8000/v1".to_string());
        
        // 1. 初始化一个针对本地 Qwen 的 OpenAI 兼容客户端
        let qwen_client = OpenAiCompatClient::new(api_key, OpenAiCompatConfig::openai())
            .with_base_url(&base_url); // 对接本地大模型

        let sandbox_client = OpenSandboxClient::new();

        Self {
            db,
            qwen_client,
            sandbox_client,
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
