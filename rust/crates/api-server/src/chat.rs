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

use crate::state::AppState;
use crate::runtime_bridge::{WebApiClient, WebPermissionPrompter, WebToolExecutor};
use crate::auth::AuthUser;
use runtime::{ConversationRuntime, PermissionPolicy, PermissionPromptDecision, Session};

pub async fn chat_completions(
    user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>, // 我们需要接收 frontend 传来的 session_id
) -> Sse<impl futures::stream::Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = mpsc::channel::<Event>(100);

    let qwen_client = state.qwen_client.clone();
    let tx_clone = tx.clone();
    let tx_tool = tx.clone();
    let tx_prompter = tx.clone();
    let pending_actions = state.pending_actions.clone();
    let db = state.db.clone();
    let sandbox_client = state.sandbox_client.clone();
    let user_id = user.user_id.clone();

    // 在 spawn_blocking 中运行，因为 run_turn 会大量发生线程阻塞（调用 tokio::block_in_place）
    tokio::task::spawn_blocking(move || {
        let api_client = WebApiClient {
            client: qwen_client,
            tx: tx_clone,
        };
        // 从数据库加载历史 Session，或者新建
        let mut session = Session::new();
        let session_id = payload.session_id.clone().unwrap_or_else(|| session.session_id.clone());
        session.session_id = session_id.clone();
        
        let tool_executor = WebToolExecutor::new(tx_tool, user_id.clone(), session_id.clone(), sandbox_client);
        let mut prompter = WebPermissionPrompter { 
            tx: tx_prompter,
            pending_actions,
        };
        
        let loaded_session_str: Option<String> = tokio::runtime::Handle::current().block_on(async {
            let row = sqlx::query("SELECT state FROM sessions WHERE id = ? AND user_id = ?")
                .bind(&session_id)
                .bind(&user_id)
                .fetch_optional(&db)
                .await.unwrap_or(None);
            row.map(|r| { let s: String = sqlx::Row::get(&r, "state"); s })
        });
        
        if let Some(state_json) = loaded_session_str {
            if let Ok(json_val) = runtime::json::JsonValue::parse(&state_json) {
                if let Ok(loaded_session) = Session::from_json(&json_val) {
                    session = loaded_session;
                }
            }
        }

        // 根据前端传递的 permission_mode 动态构建权限策略
        let permission_mode = match payload.permission_mode.as_deref() {
            Some("plan") => runtime::PermissionMode::ReadOnly,
            Some("execute") => runtime::PermissionMode::DangerFullAccess,
            _ => runtime::PermissionMode::DangerFullAccess,
        };

        let mut system_prompts = Vec::new();
        if permission_mode == runtime::PermissionMode::ReadOnly {
            system_prompts.push(
                "你当前处于 **Plan 模式（只读）**。\n\
                请分析任务并生成详细的执行计划，不要执行任何修改操作。\n\
                输出一份带步骤编号的行动计划清单，每个步骤用 `### Step N: 标题` 格式。\n\
                在每个步骤中说明具体要做什么、使用什么工具、预期结果。\n\
                你可以读取文件和搜索代码来辅助你的分析。".to_string()
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
            PermissionPolicy::new(permission_mode)
                .with_tool_requirement("glob_search", runtime::PermissionMode::ReadOnly)
                .with_tool_requirement("grep_search", runtime::PermissionMode::ReadOnly)
                .with_tool_requirement("list_dir", runtime::PermissionMode::ReadOnly)
                .with_tool_requirement("view_file", runtime::PermissionMode::ReadOnly)
                .with_tool_requirement("TodoWrite", runtime::PermissionMode::ReadOnly)
                .with_tool_requirement("execute_bash", runtime::PermissionMode::DangerFullAccess)
                .with_tool_requirement("write_to_file", runtime::PermissionMode::WorkspaceWrite)
                .with_tool_requirement("replace_file_content", runtime::PermissionMode::WorkspaceWrite)
                .with_tool_requirement("multi_replace_file_content", runtime::PermissionMode::WorkspaceWrite),
            system_prompts,
        )
        .with_max_iterations(max_iters);

        // 如果用户有输入，则执行一回合
        if let Some(input) = payload.input {
            // --- 预保存用户输入，防止后台执行卡死导致刷新后丢失 ---
            if let Err(e) = runtime.session_mut().push_user_text(&input) {
                eprintln!("Failed to push user text: {}", e);
            }
            let pre_state = if let Ok(json_val) = runtime.session().to_json() {
                json_val.render()
            } else {
                String::new()
            };
            let title = payload.title.clone().unwrap_or_else(|| "新的会话".to_string());
            
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
                .execute(&db).await;
            });
            // 因为 run_turn 内部会再 push 一次用户输入，我们先将其弹出来，保持一致
            runtime.session_mut().messages.pop();
            // -----------------------------------------------------
            
            let _ = runtime.run_turn(input, Some(&mut prompter));
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
        });
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
                reason: payload.reason.unwrap_or_else(|| "User denied via Web UI".to_string()),
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

pub async fn list_sessions(user: AuthUser, State(state): State<AppState>) -> Json<Vec<SessionMetadata>> {
    let rows = sqlx::query("SELECT id, title, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC")
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

pub async fn get_session(user: Option<AuthUser>, State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let row = if let Some(u) = user {
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
    }.map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
        
    if let Some(record) = row {
        let state_str: String = sqlx::Row::get(&record, "state");
        let json_val = serde_json::from_str(&state_str).unwrap_or(serde_json::json!({}));
        Ok(Json(json_val))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}

pub async fn delete_session(user: AuthUser, State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let result = sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&user.user_id)
        .execute(&state.db)
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
        
    if result.rows_affected() > 0 {
        Ok(Json(serde_json::json!({"success": true})))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}
