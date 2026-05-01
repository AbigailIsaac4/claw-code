use axum::{
    extract::{Path, State},
    response::sse::{Event, Sse},
    Json,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;

use crate::auth::AuthUser;
use crate::runtime_bridge::{WebApiClient, WebPermissionPrompter, WebToolExecutor};
use crate::state::{
    active_turn_snapshot, finish_turn, try_start_turn, ActiveTurnSnapshot, ActiveTurns, AppState,
};
use runtime::{
    ContentBlock, ConversationMessage, ConversationRuntime, MessageRole, PermissionPolicy,
    PermissionPromptDecision, Session,
};
use tools::GlobalToolRegistry;

fn build_web_permission_policy(permission_mode: runtime::PermissionMode) -> PermissionPolicy {
    match GlobalToolRegistry::builtin().permission_specs(None) {
        Ok(specs) => specs.into_iter().fold(
            PermissionPolicy::new(permission_mode),
            |policy, (name, required_permission)| {
                policy.with_tool_requirement(name, required_permission)
            },
        ),
        Err(error) => {
            tracing::error!("Failed to build web permission policy from tool registry: {error}");
            PermissionPolicy::new(permission_mode)
        }
    }
}

fn user_text_content(message: &ConversationMessage) -> Option<String> {
    if message.role != MessageRole::User {
        return None;
    }

    let mut text = String::new();
    for block in &message.blocks {
        match block {
            ContentBlock::Text { text: block_text } => text.push_str(block_text),
            _ => return None,
        }
    }
    Some(text)
}

fn remove_pending_user_prompt(session: &mut Session, input: &str) -> bool {
    let Some(last_message) = session.messages.last() else {
        return false;
    };

    if user_text_content(last_message).as_deref() != Some(input) {
        return false;
    }

    session.messages.pop();
    true
}

fn message_to_json_value(message: &ConversationMessage) -> Option<serde_json::Value> {
    serde_json::from_str(&message.to_json().render()).ok()
}

fn message_role(value: &serde_json::Value) -> Option<&str> {
    value
        .as_object()
        .and_then(|object| object.get("role"))
        .and_then(serde_json::Value::as_str)
}

fn overlay_active_turn_snapshot(
    mut session_json: serde_json::Value,
    snapshot: Option<ActiveTurnSnapshot>,
) -> serde_json::Value {
    let Some(snapshot) = snapshot else {
        return session_json;
    };
    let Some(object) = session_json.as_object_mut() else {
        return session_json;
    };

    object.insert("active_turn".to_string(), serde_json::Value::Bool(true));

    let Some(messages) = object
        .entry("messages")
        .or_insert_with(|| serde_json::json!([]))
        .as_array_mut()
    else {
        return session_json;
    };

    if message_role(messages.last().unwrap_or(&serde_json::Value::Null)) != Some("user") {
        return session_json;
    }

    for message in snapshot.messages {
        let Some(message_json) = message_to_json_value(&message) else {
            continue;
        };
        if messages.last() != Some(&message_json) {
            messages.push(message_json);
        }
    }

    session_json
}

struct ActiveTurnGuard {
    active_turns: ActiveTurns,
    user_id: String,
    session_id: String,
    finished: bool,
}

impl ActiveTurnGuard {
    fn new(active_turns: ActiveTurns, user_id: String, session_id: String) -> Self {
        Self {
            active_turns,
            user_id,
            session_id,
            finished: false,
        }
    }

    fn disarm(&mut self) {
        self.finished = true;
    }
}

impl Drop for ActiveTurnGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }

        match tokio::runtime::Handle::try_current() {
            Ok(handle) => handle.block_on(async {
                finish_turn(&self.active_turns, &self.user_id, &self.session_id).await;
            }),
            Err(error) => {
                tracing::error!(
                    "Failed to release active turn for session {}: {}",
                    self.session_id,
                    error
                );
            }
        }
    }
}

pub async fn chat_completions(
    user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>, // 我们需要接收 frontend 传来的 session_id
) -> Sse<impl futures::stream::Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::channel::<Event>(100);

    let session_id = payload
        .session_id
        .clone()
        .unwrap_or_else(|| Session::new().session_id);
    let user_id = user.user_id.clone();

    if !try_start_turn(&state.active_turns, &user_id, &session_id).await {
        let _ = tx
            .send(
                Event::default()
                    .event("runtime_error")
                    .data("当前会话已有一轮对话正在处理中，请等待上一轮结束后再发送。"),
            )
            .await;
        let _ = tx.send(Event::default().event("done").data("[DONE]")).await;
        let stream = ReceiverStream::new(rx).map(Ok);
        return Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new());
    }

    let qwen_client = state.qwen_client.clone();
    let tx_clone = tx.clone();
    let tx_tool = tx.clone();
    let tx_prompter = tx.clone();
    let pending_actions = state.pending_actions.clone();
    let db = state.db.clone();
    let sandbox_client = state.sandbox_client.clone();
    let sandbox_sessions = state.sandbox_sessions.clone();
    let active_turns = state.active_turns.clone();

    // 在 spawn_blocking 中运行，因为 run_turn 会大量发生线程阻塞（调用 tokio::block_in_place）
    tokio::task::spawn_blocking(move || {
        let mut active_turn_guard =
            ActiveTurnGuard::new(active_turns.clone(), user_id.clone(), session_id.clone());
        let api_client = WebApiClient {
            client: qwen_client,
            tx: tx_clone,
            active_turns: active_turns.clone(),
            user_id: user_id.clone(),
            session_id: session_id.clone(),
        };
        // 从数据库加载历史 Session，或者新建
        let mut session = Session::new();
        session.session_id = session_id.clone();

        // 根据前端传递的 permission_mode 动态构建权限策略
        let permission_mode = match payload.permission_mode.as_deref() {
            Some("plan") => runtime::PermissionMode::ReadOnly,
            Some("execute") => runtime::PermissionMode::DangerFullAccess,
            _ => runtime::PermissionMode::DangerFullAccess,
        };

        let tool_executor = WebToolExecutor::new(
            tx_tool,
            user_id.clone(),
            session_id.clone(),
            sandbox_client,
            sandbox_sessions,
            active_turns.clone(),
            permission_mode,
        );
        let mut prompter = WebPermissionPrompter {
            tx: tx_prompter,
            pending_actions,
        };

        let loaded_session_str: Option<String> =
            tokio::runtime::Handle::current().block_on(async {
                let row = sqlx::query("SELECT state FROM sessions WHERE id = ? AND user_id = ?")
                    .bind(&session_id)
                    .bind(&user_id)
                    .fetch_optional(&db)
                    .await
                    .unwrap_or(None);
                row.map(|r| {
                    let s: String = sqlx::Row::get(&r, "state");
                    s
                })
            });

        if let Some(state_json) = loaded_session_str {
            if let Ok(json_val) = runtime::json::JsonValue::parse(&state_json) {
                if let Ok(loaded_session) = Session::from_json(&json_val) {
                    session = loaded_session;
                }
            }
        }

        let mut system_prompts = Vec::new();
        if permission_mode == runtime::PermissionMode::ReadOnly {
            system_prompts.push(
                "你当前处于 **Plan 模式（只读）**。\n\
                请分析任务并生成详细的执行计划，不要执行任何修改操作。\n\
                输出一份带步骤编号的行动计划清单，每个步骤用 `### Step N: 标题` 格式。\n\
                在每个步骤中说明具体要做什么、使用什么工具、预期结果。\n\
                你可以读取文件和搜索代码来辅助你的分析。"
                    .to_string(),
            );
        }

        let max_iters: usize = std::env::var("MAX_AGENT_ITERATIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(25);
        let mut runtime = ConversationRuntime::new(
            session,
            api_client,
            tool_executor,
            build_web_permission_policy(permission_mode),
            system_prompts,
        )
        .with_max_iterations(max_iters);

        // 如果用户有输入，则执行一回合
        if let Some(input) = payload.input {
            let had_pending_user_prompt = remove_pending_user_prompt(runtime.session_mut(), &input);
            if !had_pending_user_prompt {
                // --- 预保存用户输入，防止后台执行卡死导致刷新后丢失 ---
                if let Err(e) = runtime.session_mut().push_user_text(&input) {
                    eprintln!("Failed to push user text: {}", e);
                }
                let pre_state = if let Ok(json_val) = runtime.session().to_json() {
                    json_val.render()
                } else {
                    String::new()
                };
                let title = payload
                    .title
                    .clone()
                    .unwrap_or_else(|| "新的会话".to_string());

                tokio::runtime::Handle::current().block_on(async {
                    let _ = sqlx::query(
                        r#"INSERT INTO sessions (id, user_id, title, state)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET state=excluded.state, title=excluded.title, updated_at=CURRENT_TIMESTAMP"#
                    )
                    .bind(&session_id)
                    .bind(&user_id)
                    .bind(&title)
                    .bind(&pre_state)
                    .execute(&db)
                    .await;
                });
                // 因为 run_turn 内部会再 push 一次用户输入，我们先将其弹出来，保持一致
                runtime.session_mut().messages.pop();
                // -----------------------------------------------------
            }

            let turn_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                runtime.run_turn(input, Some(&mut prompter))
            }));
            let turn_error = match turn_result {
                Ok(Ok(_summary)) => None,
                Ok(Err(error)) => Some(error.to_string()),
                Err(_) => {
                    Some("Conversation runtime panicked while processing the turn".to_string())
                }
            };
            if let Some(error) = turn_error {
                tracing::error!("Chat turn failed for session {}: {}", session_id, error);
                let _ = tokio::runtime::Handle::current().block_on(async {
                    tx.send(Event::default().event("runtime_error").data(error))
                        .await
                });
            }
        }

        // 保存更新后的 Session 回数据库
        let final_session = runtime.session(); // session 被消费了，不过如果是 &Session 也可以

        let state_json = if let Ok(json_val) = final_session.to_json() {
            json_val.render()
        } else {
            String::new()
        };
        let title = payload.title.unwrap_or_else(|| "新的会话".to_string());

        tokio::runtime::Handle::current().block_on(async {
            let _ = sqlx::query(
                r#"INSERT INTO sessions (id, user_id, title, state)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET state=excluded.state, title=excluded.title, updated_at=CURRENT_TIMESTAMP"#
            )
            .bind(&session_id)
            .bind(&user_id)
            .bind(&title)
            .bind(&state_json)
            .execute(&db).await;

            let _ = tx.send(Event::default().event("done").data("[DONE]")).await;
            finish_turn(&active_turns, &user_id, &session_id).await;
        });
        active_turn_guard.disarm();
    });

    let stream = ReceiverStream::new(rx).map(Ok);
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::new())
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub session_id: Option<String>,
    pub input: Option<String>,
    pub title: Option<String>,
    /// "plan" = ReadOnly, "execute" = WorkspaceWrite, 默认 = DangerFullAccess
    pub permission_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct ResolveActionRequest {
    pub action_id: String,
    pub allow: bool,
    pub reason: Option<String>,
}

pub async fn resolve_action(
    State(state): State<AppState>,
    Json(payload): Json<ResolveActionRequest>,
) -> &'static str {
    let mut actions = state.pending_actions.lock().await;

    // 取出等待中的 oneshot sender
    if let Some(sender) = actions.remove(&payload.action_id) {
        let decision = if payload.allow {
            PermissionPromptDecision::Allow
        } else {
            PermissionPromptDecision::Deny {
                reason: payload
                    .reason
                    .unwrap_or_else(|| "User denied via Web UI".to_string()),
            }
        };

        // 发送结果，唤醒大模型执行线程
        let _ = sender.send(decision);
        "Action resolved"
    } else {
        "Action not found or already resolved"
    }
}

// 补充 Session 列表 API
#[derive(Serialize)]
pub struct SessionMetadata {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

pub async fn list_sessions(
    user: AuthUser,
    State(state): State<AppState>,
) -> Json<Vec<SessionMetadata>> {
    let rows = sqlx::query(
        "SELECT id, title, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .bind(&user.user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut results = Vec::new();
    for row in rows {
        let id: String = sqlx::Row::get(&row, "id");
        let title: String = sqlx::Row::get(&row, "title");
        let updated_at: chrono::NaiveDateTime = sqlx::Row::get(&row, "updated_at");
        results.push(SessionMetadata {
            id,
            title,
            updated_at: updated_at.to_string(),
        });
    }
    Json(results)
}

pub async fn get_session(
    user: Option<AuthUser>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let user_id = user.as_ref().map(|user| user.user_id.clone());
    let row = if let Some(u) = user.as_ref() {
        sqlx::query("SELECT state FROM sessions WHERE id = ? AND user_id = ?")
            .bind(&id)
            .bind(&u.user_id)
            .fetch_optional(&state.db)
            .await
    } else {
        // 允许无登录的分享查看
        sqlx::query("SELECT state FROM sessions WHERE id = ?")
            .bind(&id)
            .fetch_optional(&state.db)
            .await
    }
    .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(record) = row {
        let state_str: String = sqlx::Row::get(&record, "state");
        let json_val = serde_json::from_str(&state_str).unwrap_or(serde_json::json!({}));
        let snapshot = if let Some(user_id) = user_id {
            active_turn_snapshot(&state.active_turns, &user_id, &id).await
        } else {
            None
        };
        Ok(Json(overlay_active_turn_snapshot(json_val, snapshot)))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

pub async fn delete_session(
    user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let result = sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&user.user_id)
        .execute(&state.db)
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() > 0 {
        if let Some(sandbox_id) = state.remove_sandbox_id(&user.user_id, &id).await {
            let _ = state.sandbox_client.kill_sandbox(&sandbox_id).await;
        }
        Ok(Json(serde_json::json!({"success": true})))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_web_permission_policy, overlay_active_turn_snapshot, remove_pending_user_prompt,
    };
    use crate::state::ActiveTurnSnapshot;
    use runtime::{ContentBlock, ConversationMessage, PermissionMode, Session};

    #[test]
    fn web_permission_policy_uses_tool_registry_requirements() {
        let policy = build_web_permission_policy(PermissionMode::ReadOnly);

        assert_eq!(
            policy.required_mode_for("bash"),
            PermissionMode::DangerFullAccess
        );
        assert_eq!(
            policy.required_mode_for("read_file"),
            PermissionMode::ReadOnly
        );
        assert_eq!(
            policy.required_mode_for("write_file"),
            PermissionMode::WorkspaceWrite
        );
        assert_eq!(
            policy.required_mode_for("edit_file"),
            PermissionMode::WorkspaceWrite
        );
        assert_eq!(
            policy.required_mode_for("TodoWrite"),
            PermissionMode::WorkspaceWrite
        );
    }

    #[test]
    fn removes_matching_pending_user_prompt_before_retry() {
        let mut session = Session::new();
        session
            .push_user_text("repeat me")
            .expect("user prompt should be recorded");

        assert!(remove_pending_user_prompt(&mut session, "repeat me"));
        assert!(session.messages.is_empty());
    }

    #[test]
    fn does_not_remove_answered_same_text_prompt() {
        let mut session = Session::new();
        session
            .push_user_text("repeat me")
            .expect("user prompt should be recorded");
        session
            .push_message(ConversationMessage::assistant(vec![ContentBlock::Text {
                text: "answered".to_string(),
            }]))
            .expect("assistant response should be recorded");

        assert!(!remove_pending_user_prompt(&mut session, "repeat me"));
        assert_eq!(session.messages.len(), 2);
    }

    #[test]
    fn active_turn_overlay_preserves_streamed_assistant_response_on_refresh() {
        let mut session = Session::new();
        session
            .push_user_text("work")
            .expect("user prompt should be recorded");
        let json = serde_json::from_str(&session.to_json().unwrap().render())
            .expect("session JSON should parse");
        let snapshot = ActiveTurnSnapshot {
            messages: vec![ConversationMessage::assistant(vec![ContentBlock::Text {
                text: "partial".to_string(),
            }])],
        };

        let rendered = overlay_active_turn_snapshot(json, Some(snapshot));
        let messages = rendered["messages"].as_array().unwrap();

        assert_eq!(rendered["active_turn"], true);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["blocks"][0]["text"], "partial");
    }
}
