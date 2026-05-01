use crate::sandbox_client::OpenSandboxClient;
use api::{OpenAiCompatClient, OpenAiCompatConfig};
use runtime::{ContentBlock, ConversationMessage, MessageRole, PermissionPromptDecision};
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub enum SandboxSessionState {
    Ready(String),
    Creating(Vec<oneshot::Sender<()>>),
}

pub type SandboxSessions = Arc<Mutex<HashMap<String, SandboxSessionState>>>;
pub type ActiveTurns = Arc<Mutex<HashMap<String, ActiveTurnSnapshot>>>;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveTurnSnapshot {
    pub messages: Vec<ConversationMessage>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub qwen_client: OpenAiCompatClient,
    pub sandbox_client: OpenSandboxClient,
    pub pending_actions: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionPromptDecision>>>>,
    pub sandbox_sessions: SandboxSessions,
    pub active_turns: ActiveTurns,
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
            active_turns: Arc::new(Mutex::new(HashMap::new())),
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

pub async fn try_start_turn(active_turns: &ActiveTurns, user_id: &str, session_id: &str) -> bool {
    let mut turns = active_turns.lock().await;
    let key = sandbox_session_key(user_id, session_id);
    if turns.contains_key(&key) {
        return false;
    }
    turns.insert(key, ActiveTurnSnapshot::default());
    true
}

pub async fn finish_turn(active_turns: &ActiveTurns, user_id: &str, session_id: &str) {
    active_turns
        .lock()
        .await
        .remove(&sandbox_session_key(user_id, session_id));
}

pub async fn active_turn_snapshot(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
) -> Option<ActiveTurnSnapshot> {
    active_turns
        .lock()
        .await
        .get(&sandbox_session_key(user_id, session_id))
        .cloned()
}

pub async fn append_active_assistant_text(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
    text: &str,
) {
    if text.is_empty() {
        return;
    }

    with_active_turn_snapshot(active_turns, user_id, session_id, |snapshot| match snapshot
        .messages
        .last_mut()
    {
        Some(message) if message.role == MessageRole::Assistant => {
            match message.blocks.last_mut() {
                Some(ContentBlock::Text { text: existing }) => existing.push_str(text),
                _ => message.blocks.push(ContentBlock::Text {
                    text: text.to_string(),
                }),
            }
        }
        _ => snapshot
            .messages
            .push(ConversationMessage::assistant(vec![ContentBlock::Text {
                text: text.to_string(),
            }])),
    })
    .await;
}

pub async fn push_active_assistant_tool_use(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
    id: String,
    name: String,
    input: String,
) {
    with_active_turn_snapshot(active_turns, user_id, session_id, |snapshot| {
        let block = ContentBlock::ToolUse { id, name, input };
        match snapshot.messages.last_mut() {
            Some(message) if message.role == MessageRole::Assistant => message.blocks.push(block),
            _ => snapshot
                .messages
                .push(ConversationMessage::assistant(vec![block])),
        }
    })
    .await;
}

pub async fn push_active_tool_result(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
    tool_name: String,
    output: String,
    is_error: bool,
) {
    with_active_turn_snapshot(active_turns, user_id, session_id, |snapshot| {
        snapshot.messages.push(ConversationMessage::tool_result(
            format!("active-{tool_name}"),
            tool_name,
            output,
            is_error,
        ));
    })
    .await;
}

async fn with_active_turn_snapshot(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
    update: impl FnOnce(&mut ActiveTurnSnapshot),
) {
    let key = sandbox_session_key(user_id, session_id);
    let mut turns = active_turns.lock().await;
    if let Some(snapshot) = turns.get_mut(&key) {
        update(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        active_turn_snapshot, append_active_assistant_text, ensure_sandbox_id_with_creator,
        finish_turn, try_start_turn, ActiveTurns, SandboxSessions,
    };
    use runtime::{ContentBlock, ConversationMessage};
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

    #[tokio::test]
    async fn active_turn_registry_rejects_duplicate_session_until_finished() {
        let active_turns: ActiveTurns = Arc::new(Mutex::new(HashMap::new()));

        assert!(try_start_turn(&active_turns, "user", "session").await);
        assert!(!try_start_turn(&active_turns, "user", "session").await);

        finish_turn(&active_turns, "user", "session").await;
        assert!(try_start_turn(&active_turns, "user", "session").await);
    }

    #[tokio::test]
    async fn active_turn_snapshot_accumulates_streamed_assistant_text_until_finished() {
        let active_turns: ActiveTurns = Arc::new(Mutex::new(HashMap::new()));

        assert!(try_start_turn(&active_turns, "user", "session").await);
        append_active_assistant_text(&active_turns, "user", "session", "hel").await;
        append_active_assistant_text(&active_turns, "user", "session", "lo").await;

        let snapshot = active_turn_snapshot(&active_turns, "user", "session")
            .await
            .expect("active turn should expose a snapshot");

        assert_eq!(
            snapshot.messages,
            vec![ConversationMessage::assistant(vec![ContentBlock::Text {
                text: "hello".to_string(),
            }])]
        );

        finish_turn(&active_turns, "user", "session").await;
        assert!(active_turn_snapshot(&active_turns, "user", "session")
            .await
            .is_none());
    }
}
