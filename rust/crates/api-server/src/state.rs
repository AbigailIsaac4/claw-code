use crate::sandbox_client::OpenSandboxClient;
use api::{OpenAiCompatClient, OpenAiCompatConfig};
use runtime::PermissionPromptDecision;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub enum SandboxSessionState {
    Ready(String),
    Creating(Vec<oneshot::Sender<()>>),
}

pub type SandboxSessions = Arc<Mutex<HashMap<String, SandboxSessionState>>>;

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
    ensure_sandbox_id_with_creator(sandbox_sessions, user_id, session_id, || async {
        sandbox_client
            .create_sandbox(user_id, Some(session_id.to_string()))
            .await
    })
    .await
}

pub(crate) async fn ensure_sandbox_id_with_creator<F, Fut>(
    sandbox_sessions: &SandboxSessions,
    user_id: &str,
    session_id: &str,
    creator: F,
) -> Result<String, String>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    enum EnsureAction {
        Wait(oneshot::Receiver<()>),
        Create,
    }

    let key = sandbox_session_key(user_id, session_id);
    loop {
        let action = {
            let mut sessions = sandbox_sessions.lock().await;
            match sessions.get_mut(&key) {
                Some(SandboxSessionState::Ready(existing)) => return Ok(existing.clone()),
                Some(SandboxSessionState::Creating(waiters)) => {
                    let (tx, rx) = oneshot::channel();
                    waiters.push(tx);
                    EnsureAction::Wait(rx)
                }
                None => {
                    sessions.insert(key.clone(), SandboxSessionState::Creating(Vec::new()));
                    EnsureAction::Create
                }
            }
        };

        match action {
            EnsureAction::Wait(rx) => {
                let _ = rx.await;
            }
            EnsureAction::Create => {
                let created = creator().await;
                let mut sessions = sandbox_sessions.lock().await;

                match created {
                    Ok(id) => {
                        let waiters = match sessions.remove(&key) {
                            Some(SandboxSessionState::Creating(waiters)) => waiters,
                            Some(SandboxSessionState::Ready(existing)) => {
                                sessions.insert(
                                    key.clone(),
                                    SandboxSessionState::Ready(existing.clone()),
                                );
                                return Ok(existing);
                            }
                            None => {
                                return Err(
                                    "sandbox session was removed while creation was in flight"
                                        .to_string(),
                                );
                            }
                        };
                        sessions.insert(key.clone(), SandboxSessionState::Ready(id.clone()));
                        drop(sessions);
                        for waiter in waiters {
                            let _ = waiter.send(());
                        }
                        return Ok(id);
                    }
                    Err(error) => {
                        let waiters = match sessions.remove(&key) {
                            Some(SandboxSessionState::Creating(waiters)) => waiters,
                            Some(SandboxSessionState::Ready(existing)) => {
                                sessions.insert(key.clone(), SandboxSessionState::Ready(existing));
                                Vec::new()
                            }
                            None => Vec::new(),
                        };
                        drop(sessions);
                        for waiter in waiters {
                            let _ = waiter.send(());
                        }
                        return Err(error);
                    }
                }
            }
        }
    }
}

pub async fn remove_sandbox_id(
    sandbox_sessions: &SandboxSessions,
    user_id: &str,
    session_id: &str,
) -> Option<String> {
    match sandbox_sessions
        .lock()
        .await
        .remove(&sandbox_session_key(user_id, session_id))
    {
        Some(SandboxSessionState::Ready(sandbox_id)) => Some(sandbox_id),
        Some(SandboxSessionState::Creating(waiters)) => {
            for waiter in waiters {
                let _ = waiter.send(());
            }
            None
        }
        None => None,
    }
}

fn sandbox_session_key(user_id: &str, session_id: &str) -> String {
    format!("{user_id}\0{session_id}")
}

#[cfg(test)]
mod tests {
    use super::{ensure_sandbox_id_with_creator, SandboxSessions};
    use std::collections::HashMap;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn concurrent_sandbox_creation_reuses_single_inflight_request() {
        let sessions: SandboxSessions = Arc::new(Mutex::new(HashMap::new()));
        let create_count = Arc::new(AtomicUsize::new(0));

        let mut tasks = Vec::new();
        for _ in 0..5 {
            let sessions = sessions.clone();
            let create_count = create_count.clone();
            tasks.push(tokio::spawn(async move {
                ensure_sandbox_id_with_creator(&sessions, "user", "session", || {
                    let create_count = create_count.clone();
                    async move {
                        create_count.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                        Ok("sandbox-1".to_string())
                    }
                })
                .await
            }));
        }

        let mut ids = Vec::new();
        for task in tasks {
            ids.push(
                task.await
                    .expect("task should join")
                    .expect("ensure should pass"),
            );
        }

        assert_eq!(ids, vec!["sandbox-1"; 5]);
        assert_eq!(create_count.load(Ordering::SeqCst), 1);
    }
}
