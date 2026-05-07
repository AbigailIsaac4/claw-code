use api::{OpenAiCompatClient, OpenAiCompatConfig};
use runtime::{ContentBlock, ConversationMessage, MessageRole, PermissionPromptDecision};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

pub type ActiveTurns = Arc<Mutex<HashMap<String, ActiveTurnSnapshot>>>;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveTurnSnapshot {
    pub messages: Vec<ConversationMessage>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub qwen_client: OpenAiCompatClient,
    pub pending_actions: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionPromptDecision>>>>,
    pub active_turns: ActiveTurns,
}

impl AppState {
    pub fn new(db: sqlx::SqlitePool) -> Self {
        let api_key = std::env::var("OPENAI_API_KEY")
            .or_else(|_| std::env::var("QWEN_API_KEY"))
            .unwrap_or_else(|_| "sk-local-qwen".to_string());
        let base_url = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "http://10.50.70.91:8000/v1".to_string());

        let qwen_client =
            OpenAiCompatClient::new(api_key, OpenAiCompatConfig::openai()).with_base_url(&base_url);

        Self {
            db,
            qwen_client,
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
            active_turns: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn try_start_turn(active_turns: &ActiveTurns, user_id: &str, session_id: &str) -> bool {
    let mut turns = active_turns.lock().await;
    let key = session_key(user_id, session_id);
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
        .remove(&session_key(user_id, session_id));
}

pub async fn active_turn_snapshot(
    active_turns: &ActiveTurns,
    user_id: &str,
    session_id: &str,
) -> Option<ActiveTurnSnapshot> {
    active_turns
        .lock()
        .await
        .get(&session_key(user_id, session_id))
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
    let key = session_key(user_id, session_id);
    let mut turns = active_turns.lock().await;
    if let Some(snapshot) = turns.get_mut(&key) {
        update(snapshot);
    }
}

fn session_key(user_id: &str, session_id: &str) -> String {
    format!("{user_id}\0{session_id}")
}

#[cfg(test)]
mod tests {
    use super::{
        active_turn_snapshot, append_active_assistant_text, finish_turn, try_start_turn,
        ActiveTurns,
    };
    use runtime::{ContentBlock, ConversationMessage};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;

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
