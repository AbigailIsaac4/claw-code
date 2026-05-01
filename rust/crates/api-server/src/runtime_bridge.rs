use crate::sandbox_client::{sanitize_workspace_path, OpenSandboxClient};
use crate::state::{
    append_active_assistant_text, ensure_sandbox_id, push_active_assistant_tool_use,
    push_active_tool_result, remove_sandbox_id, ActiveTurns, SandboxSessions,
};
use api::{MessageRequest, OpenAiCompatClient};
use axum::response::sse::Event;
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, PermissionPromptDecision, PermissionPrompter,
    PermissionRequest, RuntimeError, ToolError, ToolExecutor,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::{mpsc::Sender, oneshot, Mutex};
use tools::GlobalToolRegistry;

static ACTION_COUNTER: AtomicUsize = AtomicUsize::new(1);

pub struct WebApiClient {
    pub client: OpenAiCompatClient,
    pub tx: Sender<Event>,
    pub active_turns: ActiveTurns,
    pub user_id: String,
    pub session_id: String,
}

impl ApiClient for WebApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let mut events = Vec::new();

        let mapped_messages = request
            .messages
            .iter()
            .filter_map(|message| {
                let role = match message.role {
                    runtime::MessageRole::System
                    | runtime::MessageRole::User
                    | runtime::MessageRole::Tool => "user",
                    runtime::MessageRole::Assistant => "assistant",
                };
                let content = message
                    .blocks
                    .iter()
                    .map(|block| match block {
                        runtime::ContentBlock::Text { text } => {
                            api::InputContentBlock::Text { text: text.clone() }
                        }
                        runtime::ContentBlock::ToolUse { id, name, input } => {
                            api::InputContentBlock::ToolUse {
                                id: id.clone(),
                                name: name.clone(),
                                input: serde_json::from_str(input)
                                    .unwrap_or_else(|_| serde_json::json!({ "raw": input })),
                            }
                        }
                        runtime::ContentBlock::ToolResult {
                            tool_use_id,
                            output,
                            is_error,
                            ..
                        } => api::InputContentBlock::ToolResult {
                            tool_use_id: tool_use_id.clone(),
                            content: vec![api::ToolResultContentBlock::Text {
                                text: output.clone(),
                            }],
                            is_error: *is_error,
                        },
                    })
                    .collect::<Vec<_>>();
                (!content.is_empty()).then(|| api::InputMessage {
                    role: role.to_string(),
                    content,
                })
            })
            .collect::<Vec<_>>();

        let model_name = std::env::var("OPENAI_MODEL_NAME").unwrap_or_else(|_| "qwen".to_string());
        let message_request = MessageRequest {
            model: model_name,
            messages: mapped_messages,
            system: (!request.system_prompt.is_empty()).then(|| request.system_prompt.join("\n\n")),
            tools: Some(
                tools::mvp_tool_specs()
                    .into_iter()
                    .map(|spec| api::ToolDefinition {
                        name: spec.name.to_string(),
                        description: Some(spec.description.to_string()),
                        input_schema: spec.input_schema,
                    })
                    .collect(),
            ),
            tool_choice: Some(api::ToolChoice::Auto),
            stream: true,
            max_tokens: 32000,
            ..Default::default()
        };

        // 阻塞式的 async 桥接
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let mut stream = self
                    .client
                    .stream_message(&message_request)
                    .await
                    .map_err(|e| RuntimeError::new(e.to_string()))?;

                let mut pending_tool: Option<(String, String, String)> = None;

                while let Ok(Some(event)) = stream.next_event().await {
                    match event {
                        api::StreamEvent::MessageStart(start) => {
                            for block in start.message.content {
                                match block {
                                    api::OutputContentBlock::Text { text } if !text.is_empty() => {
                                        append_active_assistant_text(
                                            &self.active_turns,
                                            &self.user_id,
                                            &self.session_id,
                                            &text,
                                        )
                                        .await;
                                        let _ = self
                                            .tx
                                            .send(
                                                Event::default()
                                                    .event("message")
                                                    .data(text.clone()),
                                            )
                                            .await;
                                        events.push(AssistantEvent::TextDelta(text));
                                    }
                                    api::OutputContentBlock::ToolUse { id, name, input } => {
                                        let input_str = if input.is_null()
                                            || (input.is_object()
                                                && input.as_object().unwrap().is_empty())
                                        {
                                            String::new()
                                        } else if input.is_string() {
                                            input.as_str().unwrap().to_string()
                                        } else {
                                            input.to_string()
                                        };
                                        push_active_assistant_tool_use(
                                            &self.active_turns,
                                            &self.user_id,
                                            &self.session_id,
                                            id.clone(),
                                            name.clone(),
                                            input_str.clone(),
                                        )
                                        .await;
                                        events.push(AssistantEvent::ToolUse {
                                            id,
                                            name,
                                            input: input_str,
                                        });
                                    }
                                    _ => {}
                                }
                            }
                        }
                        api::StreamEvent::ContentBlockStart(start) => {
                            if let api::OutputContentBlock::ToolUse { id, name, input } =
                                start.content_block
                            {
                                let input_str = if input.is_null()
                                    || (input.is_object() && input.as_object().unwrap().is_empty())
                                {
                                    String::new()
                                } else if input.is_string() {
                                    input.as_str().unwrap().to_string()
                                } else {
                                    input.to_string()
                                };
                                pending_tool = Some((id, name, input_str));
                            }
                        }
                        api::StreamEvent::ContentBlockDelta(delta) => match delta.delta {
                            api::ContentBlockDelta::TextDelta { text } if !text.is_empty() => {
                                append_active_assistant_text(
                                    &self.active_turns,
                                    &self.user_id,
                                    &self.session_id,
                                    &text,
                                )
                                .await;
                                let _ = self
                                    .tx
                                    .send(Event::default().event("message").data(text.clone()))
                                    .await;
                                events.push(AssistantEvent::TextDelta(text));
                            }
                            api::ContentBlockDelta::InputJsonDelta { partial_json } => {
                                if let Some((_, _, ref mut input)) = pending_tool {
                                    input.push_str(&partial_json);
                                }
                            }
                            _ => {}
                        },
                        api::StreamEvent::ContentBlockStop(_) => {
                            if let Some((id, name, input)) = pending_tool.take() {
                                push_active_assistant_tool_use(
                                    &self.active_turns,
                                    &self.user_id,
                                    &self.session_id,
                                    id.clone(),
                                    name.clone(),
                                    input.clone(),
                                )
                                .await;
                                events.push(AssistantEvent::ToolUse { id, name, input });
                            }
                        }
                        _ => {}
                    }
                }

                Ok::<_, RuntimeError>(())
            })
        })?;

        // 补一个 MessageStop
        events.push(AssistantEvent::MessageStop);

        Ok(events)
    }
}

pub struct WebToolExecutor {
    pub tx: Sender<Event>,
    pub sandbox_client: OpenSandboxClient,
    pub sandbox_sessions: SandboxSessions,
    pub active_turns: ActiveTurns,
    pub user_id: String,
    pub session_id: String,
    pub sandbox_id: Option<String>,
    pub tool_registry: GlobalToolRegistry,
    pub permission_mode: runtime::PermissionMode,
    /// 连续 bash 错误计数器 — 防止 agent loop 无限重试沙箱命令
    consecutive_bash_errors: u32,
}

const MAX_CONSECUTIVE_BASH_ERRORS: u32 = 3;

impl WebToolExecutor {
    pub fn new(
        tx: Sender<Event>,
        user_id: String,
        session_id: String,
        sandbox_client: OpenSandboxClient,
        sandbox_sessions: SandboxSessions,
        active_turns: ActiveTurns,
        permission_mode: runtime::PermissionMode,
    ) -> Self {
        Self {
            tx,
            sandbox_client,
            sandbox_sessions,
            active_turns,
            user_id,
            session_id,
            sandbox_id: None,
            tool_registry: GlobalToolRegistry::builtin(),
            permission_mode,
            consecutive_bash_errors: 0,
        }
    }

    async fn ensure_sandbox(&mut self) -> Result<String, String> {
        if let Some(ref id) = self.sandbox_id {
            return Ok(id.clone());
        }
        let id = ensure_sandbox_id(
            &self.sandbox_client,
            &self.sandbox_sessions,
            &self.user_id,
            &self.session_id,
        )
        .await?;
        self.sandbox_id = Some(id.clone());
        Ok(id)
    }
}

#[derive(serde::Deserialize)]
struct BashInput {
    command: String,
    timeout: Option<u64>,
}
#[derive(serde::Deserialize)]
struct ReadFileInput {
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
}
#[derive(serde::Deserialize)]
struct WriteFileInput {
    path: String,
    content: String,
}
#[derive(serde::Deserialize)]
struct EditFileInput {
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
}

fn canonical_tool_name(tool_name: &str) -> &str {
    match tool_name {
        "bash" | "Bash" => "Bash",
        "read_file" | "ReadFile" => "ReadFile",
        "write_file" | "WriteFile" => "WriteFile",
        "edit_file" | "EditFile" => "EditFile",
        other => other,
    }
}

fn validate_bash_command_for_web(
    command: &str,
    permission_mode: runtime::PermissionMode,
) -> Result<(), String> {
    match runtime::bash_validation::validate_command(
        command,
        permission_mode,
        std::path::Path::new("/workspace"),
    ) {
        runtime::bash_validation::ValidationResult::Allow => Ok(()),
        runtime::bash_validation::ValidationResult::Block { reason } => {
            Err(format!("Bash command blocked: {reason}"))
        }
        runtime::bash_validation::ValidationResult::Warn { message } => {
            Err(format!("Bash command requires approval: {message}"))
        }
    }
}

fn read_file_output(
    remote_path: String,
    content: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> runtime::ReadFileOutput {
    let lines = content.lines().collect::<Vec<_>>();
    let start_index = offset.unwrap_or(0).min(lines.len());
    let end_index = limit.map_or(lines.len(), |limit| {
        start_index.saturating_add(limit).min(lines.len())
    });
    let selected = lines[start_index..end_index].join("\n");

    runtime::ReadFileOutput {
        kind: "text".to_string(),
        file: runtime::TextFilePayload {
            file_path: remote_path,
            content: selected,
            num_lines: end_index.saturating_sub(start_index),
            start_line: start_index.saturating_add(1),
            total_lines: lines.len(),
        },
    }
}

fn make_structured_patch(original: &str, updated: &str) -> Vec<runtime::StructuredPatchHunk> {
    let mut lines = Vec::new();
    for line in original.lines() {
        lines.push(format!("-{line}"));
    }
    for line in updated.lines() {
        lines.push(format!("+{line}"));
    }

    vec![runtime::StructuredPatchHunk {
        old_start: 1,
        old_lines: original.lines().count(),
        new_start: 1,
        new_lines: updated.lines().count(),
        lines,
    }]
}

impl ToolExecutor for WebToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        // 运行工具时的副作用：通知前端进入工具执行状态
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "tool": tool_name,
                    "input": input
                }))
                .unwrap_or_default();
                let _ = self
                    .tx
                    .send(Event::default().event("tool_call_start").data(sse_data))
                    .await;
            });
        });

        let normalized_input = if input.trim().is_empty() { "{}" } else { input };
        let value: Value = serde_json::from_str(normalized_input).map_err(|e| {
            tracing::error!(
                "Failed to parse ToolUse input. Raw input: {:?}",
                normalized_input
            );
            ToolError::new(format!("Invalid input JSON: {}", e))
        })?;

        let result: Result<String, String> = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                match canonical_tool_name(tool_name) {
                    "Bash" => {
                        // 连续错误熔断：如果 bash 已连续失败多次，直接告知模型停止重试
                        if self.consecutive_bash_errors >= MAX_CONSECUTIVE_BASH_ERRORS {
                            return Err(format!(
                                "沙箱命令已连续失败 {} 次，请停止重试 bash 命令。\
                                请直接向用户说明当前沙箱执行环境不可用，建议用户检查沙箱服务状态。",
                                self.consecutive_bash_errors
                            ));
                        }
                        let sandbox_id = match self.ensure_sandbox().await {
                            Ok(id) => id,
                            Err(e) => {
                                self.consecutive_bash_errors += 1;
                                return Err(format!(
                                    "沙箱创建失败 (第{}次连续错误): {}",
                                    self.consecutive_bash_errors, e
                                ));
                            }
                        };
                        let req: BashInput =
                            serde_json::from_str(normalized_input).map_err(|e| e.to_string())?;

                        // 只读模式下的命令安全校验
                        validate_bash_command_for_web(&req.command, self.permission_mode)?;

                        match self
                            .sandbox_client
                            .execute_bash(&sandbox_id, &req.command, req.timeout)
                            .await
                        {
                            Ok(res) => {
                                // 成功执行，重置连续错误计数
                                self.consecutive_bash_errors = 0;
                                let return_code_interpretation = if res.exit_code == 0 {
                                    None
                                } else {
                                    Some(format!("exit_code:{}", res.exit_code))
                                };
                                let output = serde_json::json!({
                                    "stdout": res.stdout,
                                    "stderr": res.stderr,
                                    "interrupted": false,
                                    "return_code_interpretation": return_code_interpretation
                                });
                                Ok(serde_json::to_string_pretty(&output).unwrap_or_default())
                            }
                            Err(e) => {
                                self.consecutive_bash_errors += 1;
                                // 如果沙箱执行失败但 sandbox_id 还在，可能是容器内命令问题而非连接问题
                                // 清空 sandbox_id 以便下次重新创建
                                if e.contains("request failed") || e.contains("endpoint") {
                                    self.sandbox_id = None;
                                    remove_sandbox_id(
                                        &self.sandbox_sessions,
                                        &self.user_id,
                                        &self.session_id,
                                    )
                                    .await;
                                }
                                Err(format!(
                                    "命令执行失败 (第{}次连续错误): {}",
                                    self.consecutive_bash_errors, e
                                ))
                            }
                        }
                    }
                    "ReadFile" => {
                        let req: ReadFileInput =
                            serde_json::from_str(normalized_input).map_err(|e| e.to_string())?;
                        let sandbox_id = self.ensure_sandbox().await?;
                        let workspace_path = sanitize_workspace_path(&req.path)?;
                        let bytes = self
                            .sandbox_client
                            .download_file_bytes(&sandbox_id, &workspace_path.remote_path)
                            .await?;
                        let content = String::from_utf8(bytes).map_err(|_| {
                            format!(
                                "File {} is not valid UTF-8 text",
                                workspace_path.remote_path
                            )
                        })?;
                        let output = read_file_output(
                            workspace_path.remote_path,
                            content,
                            req.offset,
                            req.limit,
                        );
                        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
                    }
                    "WriteFile" => {
                        let req: WriteFileInput =
                            serde_json::from_str(normalized_input).map_err(|e| e.to_string())?;
                        let sandbox_id = self.ensure_sandbox().await?;
                        let workspace_path = sanitize_workspace_path(&req.path)?;
                        let original_file = self
                            .sandbox_client
                            .download_file_bytes(&sandbox_id, &workspace_path.remote_path)
                            .await
                            .ok()
                            .and_then(|bytes| String::from_utf8(bytes).ok());
                        let remote_path = self
                            .sandbox_client
                            .upload_file_bytes(
                                &sandbox_id,
                                &workspace_path.remote_path,
                                req.content.as_bytes(),
                            )
                            .await?;
                        let structured_patch = make_structured_patch(
                            original_file.as_deref().unwrap_or(""),
                            &req.content,
                        );
                        let output = runtime::WriteFileOutput {
                            kind: if original_file.is_some() {
                                "update"
                            } else {
                                "create"
                            }
                            .to_string(),
                            file_path: remote_path,
                            content: req.content,
                            structured_patch,
                            original_file,
                            git_diff: None,
                        };
                        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
                    }
                    "EditFile" => {
                        let req: EditFileInput =
                            serde_json::from_str(normalized_input).map_err(|e| e.to_string())?;
                        if req.old_string == req.new_string {
                            return Err("old_string and new_string must differ".to_string());
                        }

                        let sandbox_id = self.ensure_sandbox().await?;
                        let workspace_path = sanitize_workspace_path(&req.path)?;
                        let bytes = self
                            .sandbox_client
                            .download_file_bytes(&sandbox_id, &workspace_path.remote_path)
                            .await?;
                        let original_file = String::from_utf8(bytes).map_err(|_| {
                            format!(
                                "File {} is not valid UTF-8 text",
                                workspace_path.remote_path
                            )
                        })?;
                        if !original_file.contains(&req.old_string) {
                            return Err("old_string not found in file".to_string());
                        }

                        let replace_all = req.replace_all.unwrap_or(false);
                        let updated = if replace_all {
                            original_file.replace(&req.old_string, &req.new_string)
                        } else {
                            original_file.replacen(&req.old_string, &req.new_string, 1)
                        };
                        let remote_path = self
                            .sandbox_client
                            .upload_file_bytes(
                                &sandbox_id,
                                &workspace_path.remote_path,
                                updated.as_bytes(),
                            )
                            .await?;
                        let output = runtime::EditFileOutput {
                            file_path: remote_path,
                            old_string: req.old_string,
                            new_string: req.new_string,
                            structured_patch: make_structured_patch(&original_file, &updated),
                            original_file,
                            user_modified: false,
                            replace_all,
                            git_diff: None,
                        };
                        serde_json::to_string_pretty(&output).map_err(|e| e.to_string())
                    }
                    _ => {
                        // 回退到 tools::lib 原生执行
                        self.tool_registry
                            .execute(tool_name, &value)
                            .map_err(|e| e.to_string())
                            .and_then(|v| {
                                serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
                            })
                    }
                }
            })
        });

        match &result {
            Ok(output) => {
                tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(async {
                        push_active_tool_result(
                            &self.active_turns,
                            &self.user_id,
                            &self.session_id,
                            tool_name.to_string(),
                            output.clone(),
                            false,
                        )
                        .await;
                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "result": output
                        }))
                        .unwrap_or_default();
                        let _ = self
                            .tx
                            .send(Event::default().event("tool_call_result").data(sse_data))
                            .await;
                    });
                });
            }
            Err(e) => {
                tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(async {
                        push_active_tool_result(
                            &self.active_turns,
                            &self.user_id,
                            &self.session_id,
                            tool_name.to_string(),
                            e.to_string(),
                            true,
                        )
                        .await;
                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "error": e.to_string()
                        }))
                        .unwrap_or_default();
                        let _ = self
                            .tx
                            .send(Event::default().event("tool_call_result").data(sse_data))
                            .await;
                    });
                });
            }
        }

        result.map_err(ToolError::new)
    }
}

pub struct WebPermissionPrompter {
    pub tx: Sender<Event>,
    pub pending_actions: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionPromptDecision>>>>,
}

impl PermissionPrompter for WebPermissionPrompter {
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        let action_id = format!("action_{}", ACTION_COUNTER.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();

        // 将 sender 放入全局 pending_actions 以供 /resolve 调用
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let mut actions = self.pending_actions.lock().await;
                actions.insert(action_id.clone(), tx);
            });
        });

        // 向前端发送阻断授权请求事件，并在事件中带上 action_id
        let send_result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "action_id": action_id,
                    "tool": request.tool_name,
                    "required_mode": request.required_mode.as_str(),
                    "message": "需要用户审批"
                }))
                .unwrap_or_default();
                self.tx
                    .send(Event::default().event("action_required").data(sse_data))
                    .await
            })
        });

        // 如果发送失败，说明客户端已经断开连接（后台异步执行状态）。此时直接拒绝，防止死锁挂起。
        if send_result.is_err() {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    let mut actions = self.pending_actions.lock().await;
                    actions.remove(&action_id);
                });
            });
            return PermissionPromptDecision::Deny {
                reason:
                    "Client disconnected. Auto-denied to prevent blocking background execution."
                        .to_string(),
            };
        }

        // 挂起当前引擎执行线程，等待前端审批结果（通过 /resolve REST API 回传）
        match rx.blocking_recv() {
            Ok(decision) => decision,
            Err(_) => PermissionPromptDecision::Deny {
                reason: "Internal error: Action channel closed or dropped".to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_tool_name, make_structured_patch, validate_bash_command_for_web};
    use runtime::PermissionMode;

    #[test]
    fn canonical_tool_name_maps_lowercase_file_tools() {
        assert_eq!(canonical_tool_name("read_file"), "ReadFile");
        assert_eq!(canonical_tool_name("write_file"), "WriteFile");
        assert_eq!(canonical_tool_name("edit_file"), "EditFile");
        assert_eq!(canonical_tool_name("bash"), "Bash");
    }

    #[test]
    fn web_bash_validation_rejects_warn_results() {
        let err = validate_bash_command_for_web("rm -rf /", PermissionMode::DangerFullAccess)
            .expect_err("destructive warnings should not execute silently");

        assert!(err.contains("requires approval"));
    }

    #[test]
    fn web_file_tools_return_patch_metadata() {
        let patch = make_structured_patch("old\nvalue", "new\nvalue");

        assert_eq!(patch.len(), 1);
        assert_eq!(patch[0].old_lines, 2);
        assert_eq!(patch[0].new_lines, 2);
        assert_eq!(
            patch[0].lines,
            vec![
                "-old".to_string(),
                "-value".to_string(),
                "+new".to_string(),
                "+value".to_string()
            ]
        );
    }
}
