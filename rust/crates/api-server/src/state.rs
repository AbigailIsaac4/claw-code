use crate::sandbox_client::OpenSandboxClient;
use api::{OpenAiCompatClient, OpenAiCompatConfig};
use runtime::PermissionPromptDecision;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub type SandboxSessions = Arc<Mutex<HashMap<String, String>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub qwen_client: OpenAiCompatClient,
    pub sandbox_client: OpenSandboxClient,
    pub pending_actions: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionPromptDecision>>>>,
    pub sandbox_sessions: SandboxSessions,
}

impl AppState {
    pub fn new(db: sqlx::SqlitePool) -> Self {
        let api_key = std::env::var("OPENAI_API_KEY")
            .or_else(|_| std::env::var("QWEN_API_KEY"))
            .unwrap_or_else(|_| "sk-local-qwen".to_string());
        let base_url = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "http://10.50.70.91:8000/v1".to_string());

        // 1. 初始化一个针对本地 Qwen 的 OpenAI 兼容客户端
        let qwen_client =
            OpenAiCompatClient::new(api_key, OpenAiCompatConfig::openai()).with_base_url(&base_url); // 对接本地大模型

        let sandbox_client = OpenSandboxClient::new();

        Self {
            db,
            qwen_client,
            sandbox_client,
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
            sandbox_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn ensure_sandbox_id(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<String, String> {
        ensure_sandbox_id(
            &self.sandbox_client,
            &self.sandbox_sessions,
            user_id,
            session_id,
        )
        .await
    }

    pub async fn remove_sandbox_id(&self, user_id: &str, session_id: &str) -> Option<String> {
        remove_sandbox_id(&self.sandbox_sessions, user_id, session_id).await
    }
}

pub async fn ensure_sandbox_id(
    sandbox_client: &OpenSandboxClient,
    sandbox_sessions: &SandboxSessions,
    user_id: &str,
    session_id: &str,
) -> Result<String, String> {
    let key = sandbox_session_key(user_id, session_id);
    if let Some(existing) = sandbox_sessions.lock().await.get(&key).cloned() {
        return Ok(existing);
    }

    let created = sandbox_client
        .create_sandbox(user_id, Some(session_id.to_string()))
        .await?;

    let existing = {
        let mut sessions = sandbox_sessions.lock().await;
        if let Some(existing) = sessions.get(&key).cloned() {
            Some(existing)
        } else {
            sessions.insert(key, created.clone());
            None
        }
    };

    if let Some(existing) = existing {
        let _ = sandbox_client.kill_sandbox(&created).await;
        Ok(existing)
    } else {
        Ok(created)
    }
}

pub async fn remove_sandbox_id(
    sandbox_sessions: &SandboxSessions,
    user_id: &str,
    session_id: &str,
) -> Option<String> {
    sandbox_sessions
        .lock()
        .await
        .remove(&sandbox_session_key(user_id, session_id))
}

fn sandbox_session_key(user_id: &str, session_id: &str) -> String {
    format!("{user_id}\0{session_id}")
}
