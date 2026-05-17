use crate::state::{
    append_active_assistant_text, push_active_assistant_tool_use, push_active_tool_result,
    ActiveTurns,
};
use crate::workspace::{
    canonical_workspace_root, resolve_existing_workspace_path, resolve_workspace_search_path,
    resolve_workspace_write_path, sanitize_workspace_path,
};
use api::{MessageRequest, OpenAiCompatClient};
use axum::response::sse::Event;
use runtime::permission_enforcer::PermissionEnforcer;
use runtime::{
    ApiClient, ApiRequest, AssistantEvent, PermissionPolicy, PermissionPromptDecision,
    PermissionPrompter, PermissionRequest, RuntimeError, ToolError, ToolExecutor,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    pub iteration_count: usize,
}

impl ApiClient for WebApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let mut events = Vec::new();

        // Emit iteration boundary event so the frontend can track agent progress
        self.iteration_count += 1;
        let iteration = self.iteration_count;
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "iteration": iteration,
                    "phase": "llm_call"
                }))
                .unwrap_or_default();
                let _ = self
                    .tx
                    .send(Event::default().event("iteration_start").data(sse_data))
                    .await;
            });
        });

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
        // Compute max_tokens before moving model_name into the struct.
        // The old default of 8192 was far too low — tool calls with large file
        // content were truncated mid-JSON, causing "missing field" errors.
        let max_tokens = std::env::var("MAX_OUTPUT_TOKENS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| api::max_tokens_for_model(&model_name));
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
            max_tokens,
            ..Default::default()
        };

        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let mut stream = self
                    .client
                    .stream_message(&message_request)
                    .await
                    .map_err(|error| RuntimeError::new(error.to_string()))?;

                let mut pending_tool: Option<(String, String, String)> = None;

                loop {
                    match stream.next_event().await {
                        Ok(Some(event)) => match event {
                            api::StreamEvent::MessageStart(start) => {
                                for block in start.message.content {
                                    match block {
                                        api::OutputContentBlock::Text { text } if !text.is_empty() => {
                                            self.push_text_delta(&mut events, text).await;
                                        }
                                        api::OutputContentBlock::ToolUse { id, name, input } => {
                                            let input = tool_input_to_string(input);
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
                                        _ => {}
                                    }
                                }
                            }
                            api::StreamEvent::ContentBlockStart(start) => {
                                if let api::OutputContentBlock::ToolUse { id, name, input } =
                                    start.content_block
                                {
                                    pending_tool = Some((id, name, tool_input_to_string(input)));
                                }
                            }
                            api::StreamEvent::ContentBlockDelta(delta) => match delta.delta {
                                api::ContentBlockDelta::TextDelta { text } if !text.is_empty() => {
                                    self.push_text_delta(&mut events, text).await;
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
                        },
                        Ok(None) => break,
                        Err(error) => {
                            tracing::error!(
                                "LLM stream error for session {}: {}",
                                self.session_id,
                                error
                            );
                            let error_msg = format!("LLM stream error: {error}");
                            let _ = self
                                .tx
                                .send(
                                    Event::default()
                                        .event("runtime_error")
                                        .data(&error_msg),
                                )
                                .await;
                            return Err(RuntimeError::new(error_msg));
                        }
                    }
                }

                Ok::<_, RuntimeError>(())
            })
        })?;

        events.push(AssistantEvent::MessageStop);
        Ok(events)
    }
}

impl WebApiClient {
    async fn push_text_delta(&self, events: &mut Vec<AssistantEvent>, text: String) {
        append_active_assistant_text(&self.active_turns, &self.user_id, &self.session_id, &text)
            .await;

        // Detect <thinking> tags and emit as separate event type
        let is_thinking = text.contains("<thinking>") || text.contains("</thinking>");
        let sse_event_type = if is_thinking { "thinking_delta" } else { "message" };

        let sse_data = serde_json::to_string(&serde_json::json!({
            "choices": [{
                "delta": {
                    "content": text
                }
            }]
        }))
        .unwrap_or_default();
        let _ = self
            .tx
            .send(Event::default().event(sse_event_type).data(sse_data))
            .await;
        events.push(AssistantEvent::TextDelta(text));
    }
}

pub struct WebToolExecutor {
    pub tx: Sender<Event>,
    pub active_turns: ActiveTurns,
    pub user_id: String,
    pub session_id: String,
    pub workspace_dir: PathBuf,
    pub sandbox_config: Option<crate::chat::SandboxConfigRequest>,
    pub session_env: Option<std::collections::HashMap<String, String>>,
    pub pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    tool_registry: GlobalToolRegistry,
}

impl WebToolExecutor {
    pub fn new(
        tx: Sender<Event>,
        user_id: String,
        session_id: String,
        active_turns: ActiveTurns,
        permission_mode: runtime::PermissionMode,
        workspace_dir: PathBuf,
        sandbox_config: Option<crate::chat::SandboxConfigRequest>,
        session_env: Option<std::collections::HashMap<String, String>>,
        pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    ) -> Self {
        Self {
            tx,
            active_turns,
            user_id,
            session_id,
            workspace_dir,
            sandbox_config,
            session_env,
            pending_questions,
            tool_registry: build_tool_registry(permission_mode),
        }
    }

    fn execute_registry_tool(&self, tool_name: &str, input: &str) -> Result<String, String> {
        let normalized_input = if input.trim().is_empty() { "{}" } else { input };
        let raw_input_value: Value = match serde_json::from_str(normalized_input) {
            Ok(v) => v,
            Err(_) => {
                // Attempt to repair common model output malformations
                let repaired = repair_json(normalized_input);
                serde_json::from_str(&repaired).map_err(|error| {
                    tracing::error!(
                        "Failed to parse ToolUse input. Raw input: {:?}",
                        normalized_input
                    );
                    format!("Invalid input JSON: {error}")
                })?
            }
        };

        let canonical_name = canonical_tool_name(tool_name);
        if canonical_name == "glob_search" {
            return self.execute_glob_search(&raw_input_value);
        }
        if canonical_name == "grep_search" {
            return self.execute_grep_search(&raw_input_value);
        }

        let input_value =
            normalize_tool_input_paths(canonical_name, raw_input_value, &self.workspace_dir)?;

        // Ensure workspace directory exists
        std::fs::create_dir_all(&self.workspace_dir)
            .map_err(|error| format!("Failed to create session workspace: {error}"))?;

        // For bash tool, inject workspace as cwd, sandbox config, and env vars from request
        let input_value = if canonical_name == "bash" {
            inject_bash_config(
                input_value,
                &self.workspace_dir,
                self.sandbox_config.as_ref(),
                self.session_env.as_ref(),
            )?
        } else {
            input_value
        };

        // Intercept AskUserQuestion to route through SSE instead of stdin
        if canonical_name == "AskUserQuestion" {
            return self.execute_ask_user_question(&input_value);
        }

        self.tool_registry
            .execute(canonical_name, &input_value)
            .map_err(|e| e.to_string())
    }

    fn execute_ask_user_question(&self, input: &Value) -> Result<String, String> {
        let question = input
            .get("question")
            .and_then(|v| v.as_str())
            .unwrap_or("Agent has a question")
            .to_string();
        let options: Option<Vec<String>> = input.get("options").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        });

        let question_id = format!("q_{}", ACTION_COUNTER.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();

        // Register sender
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                self.pending_questions.lock().await.insert(question_id.clone(), tx);
            });
        });

        // Send SSE event
        let sse_data = serde_json::to_string(&serde_json::json!({
            "question_id": question_id,
            "question": question,
            "options": options,
        }))
        .unwrap_or_default();

        let send_result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                self.tx
                    .send(Event::default().event("question_required").data(sse_data))
                    .await
            })
        });

        if send_result.is_err() {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    self.pending_questions.lock().await.remove(&question_id);
                });
            });
            return Err("Client disconnected".to_string());
        }

        // Wait for user response
        match rx.blocking_recv() {
            Ok(answer) => Ok(answer),
            Err(_) => Err("Question channel closed or dropped".to_string()),
        }
    }

    fn execute_glob_search(&self, input: &Value) -> Result<String, String> {
        let mut input: GlobSearchInputValue = serde_json::from_value(input.clone())
            .map_err(|error| format!("Invalid input JSON: {error}"))?;
        input.pattern = sanitize_workspace_path(&input.pattern)?;

        let base_path = resolve_workspace_search_path(&self.workspace_dir, input.path.as_deref())?;
        validate_glob_pattern_prefix(&self.workspace_dir, &base_path, &input.pattern)?;

        let base_path_string = base_path.to_string_lossy().into_owned();
        let mut output = runtime::glob_search(&input.pattern, Some(base_path_string.as_str()))
            .map_err(|error| error.to_string())?;
        output
            .filenames
            .retain(|filename| is_workspace_match(&self.workspace_dir, Path::new(filename)));
        output.num_files = output.filenames.len();

        serde_json::to_string_pretty(&output)
            .map_err(|error| format!("Failed to encode glob_search output: {error}"))
    }

    fn execute_grep_search(&self, input: &Value) -> Result<String, String> {
        let mut input: runtime::GrepSearchInput = serde_json::from_value(input.clone())
            .map_err(|error| format!("Invalid input JSON: {error}"))?;
        let base_path = resolve_workspace_search_path(&self.workspace_dir, input.path.as_deref())?;
        input.path = Some(base_path.to_string_lossy().into_owned());

        let output = runtime::grep_search(&input).map_err(|error| error.to_string())?;
        serde_json::to_string_pretty(&output)
            .map_err(|error| format!("Failed to encode grep_search output: {error}"))
    }

    fn send_tool_start(&self, tool_name: &str, input: &str) {
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
    }

    fn send_tool_result(&self, tool_name: &str, result: &Result<String, String>, artifacts: Vec<String>) {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                match result {
                    Ok(output) => {
                        push_active_tool_result(
                            &self.active_turns,
                            &self.user_id,
                            &self.session_id,
                            tool_name.to_string(),
                            output.clone(),
                            false,
                        )
                        .await;
                        let mut is_error_from_payload = false;
                        if tool_name == "bash" {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&output) {
                                if let Some(rc) = parsed.get("return_code_interpretation").and_then(|v| v.as_str()) {
                                    if rc.starts_with("exit_code:") {
                                        is_error_from_payload = true;
                                    }
                                }
                            }
                        }

                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "result": output,
                            "error": is_error_from_payload,
                            "artifacts": artifacts
                        }))
                        .unwrap_or_default();
                        let _ = self
                            .tx
                            .send(Event::default().event("tool_call_result").data(sse_data))
                            .await;
                    }
                    Err(error) => {
                        push_active_tool_result(
                            &self.active_turns,
                            &self.user_id,
                            &self.session_id,
                            tool_name.to_string(),
                            error.clone(),
                            true,
                        )
                        .await;
                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "error": error,
                            "artifacts": artifacts
                        }))
                        .unwrap_or_default();
                        let _ = self
                            .tx
                            .send(Event::default().event("tool_call_result").data(sse_data))
                            .await;
                    }
                }
            });
        });
    }
}

impl ToolExecutor for WebToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        self.send_tool_start(tool_name, input);

        // Spawn a heartbeat task that sends periodic SSE events during tool execution
        let heartbeat_tx = self.tx.clone();
        let heartbeat_tool = tool_name.to_string();
        let heartbeat_cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let heartbeat_cancel_clone = heartbeat_cancel.clone();

        let heartbeat_handle = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if heartbeat_cancel_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                let elapsed_ms = start.elapsed().as_millis() as u64;
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "tool": heartbeat_tool,
                    "elapsed_ms": elapsed_ms,
                    "phase": "executing_tool"
                }))
                .unwrap_or_default();
                // Use try_send-like behavior: if send fails, stop heartbeat
                let send_result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(async {
                        heartbeat_tx
                            .send(Event::default().event("heartbeat").data(sse_data))
                            .await
                    })
                });
                if send_result.is_err() {
                    break;
                }
            }
        });

        let pre_snapshot = snapshot_workspace(&self.workspace_dir);

        let result = self.execute_registry_tool(tool_name, input);

        let post_snapshot = snapshot_workspace(&self.workspace_dir);
        let artifacts = diff_snapshots(&pre_snapshot, &post_snapshot);

        // Stop heartbeat
        heartbeat_cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = heartbeat_handle.join();

        self.send_tool_result(tool_name, &result, artifacts);
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

        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let mut actions = self.pending_actions.lock().await;
                actions.insert(action_id.clone(), tx);
            });
        });

        let send_result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "action_id": action_id,
                    "tool": request.tool_name,
                    "required_mode": request.required_mode.as_str(),
                    "message": "User approval is required"
                }))
                .unwrap_or_default();
                self.tx
                    .send(Event::default().event("action_required").data(sse_data))
                    .await
            })
        });

        if send_result.is_err() {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    let mut actions = self.pending_actions.lock().await;
                    actions.remove(&action_id);
                });
            });
            return PermissionPromptDecision::Deny {
                reason: "Client disconnected. Auto-denied to prevent background blocking."
                    .to_string(),
            };
        }

        match rx.blocking_recv() {
            Ok(decision) => decision,
            Err(_) => PermissionPromptDecision::Deny {
                reason: "Internal error: Action channel closed or dropped".to_string(),
            },
        }
    }
}

fn snapshot_workspace(dir: &Path) -> HashMap<String, std::time::SystemTime> {
    let mut map = HashMap::new();
    if !dir.exists() {
        return map;
    }
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && name != "node_modules" && name != "target"
        })
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(mtime) = metadata.modified() {
                    let rel_path = entry.path().strip_prefix(dir).unwrap_or(entry.path());
                    map.insert(rel_path.to_string_lossy().into_owned().replace('\\', "/"), mtime);
                }
            }
        }
    }
    map
}

fn diff_snapshots(
    pre: &HashMap<String, std::time::SystemTime>,
    post: &HashMap<String, std::time::SystemTime>,
) -> Vec<String> {
    let mut diff = Vec::new();
    for (path, mtime) in post {
        if let Some(old_mtime) = pre.get(path) {
            if mtime > old_mtime {
                diff.push(path.clone());
            }
        } else {
            diff.push(path.clone());
        }
    }
    diff
}

fn tool_input_to_string(input: Value) -> String {
    if input.is_null() || input.as_object().is_some_and(Map::is_empty) {
        String::new()
    } else if input.is_string() {
        input.as_str().unwrap_or_default().to_string()
    } else {
        input.to_string()
    }
}

/// Attempt to repair common JSON malformations from model output.
fn repair_json(input: &str) -> String {
    let mut s = input.trim().to_string();

    // Fix double-quoted keys: ""key"" → "key"
    // Pattern: two consecutive quotes followed by non-quote chars and two consecutive quotes
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '"' && chars[i + 1] == '"' {
            // Start of double-quote — emit single quote
            result.push('"');
            i += 2;
            // Skip until closing double-quote pair
            while i < chars.len() {
                if i + 1 < chars.len() && chars[i] == '"' && chars[i + 1] == '"' {
                    // Check if this is end of key (followed by :) or end of value
                    let rest: String = chars[i + 2..].iter().collect();
                    if rest.trim_start().starts_with(':') || rest.trim_start().starts_with(',') || rest.trim_start().starts_with('}') || rest.trim_start().is_empty() {
                        result.push('"');
                        i += 2;
                        break;
                    } else {
                        // Interior double-quotes — keep one
                        result.push('"');
                        i += 2;
                    }
                } else {
                    result.push(chars[i]);
                    i += 1;
                }
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    s = result;

    // Try parsing as-is first
    if serde_json::from_str::<serde_json::Value>(&s).is_ok() {
        return s;
    }

    // Fix truncated JSON: count open vs close braces/brackets and close them
    let mut brace_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for ch in s.chars() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match ch {
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            _ => {}
        }
    }
    // Close any unclosed string
    if in_string {
        s.push('"');
    }
    // Close brackets first, then braces
    for _ in 0..bracket_depth.max(0) {
        s.push(']');
    }
    for _ in 0..brace_depth.max(0) {
        s.push('}');
    }

    s
}

fn canonical_tool_name(tool_name: &str) -> &str {
    match tool_name {
        "bash" | "Bash" => "bash",
        "read_file" | "ReadFile" => "read_file",
        "write_file" | "WriteFile" => "write_file",
        "edit_file" | "EditFile" => "edit_file",
        "skills" | "skill" | "Skill" => "Skill",
        other => other,
    }
}

fn build_tool_registry(permission_mode: runtime::PermissionMode) -> GlobalToolRegistry {
    let registry = GlobalToolRegistry::builtin();
    let policy = match registry.permission_specs(None) {
        Ok(specs) => specs.into_iter().fold(
            PermissionPolicy::new(permission_mode),
            |policy, (name, required_permission)| {
                policy.with_tool_requirement(name, required_permission)
            },
        ),
        Err(error) => {
            tracing::error!("Failed to build web tool permission policy: {error}");
            PermissionPolicy::new(permission_mode)
        }
    };

    registry.with_enforcer(PermissionEnforcer::new(policy))
}

fn normalize_tool_input_paths(
    tool_name: &str,
    mut input: Value,
    workspace: &Path,
) -> Result<Value, String> {
    if let Value::Object(object) = &mut input {
        match tool_name {
            "read_file" => normalize_read_path_field(object, "path", workspace)?,
            "write_file" => normalize_write_path_field(object, "path", workspace)?,
            "edit_file" => normalize_read_path_field(object, "path", workspace)?,
            _ => {}
        }
    }
    Ok(input)
}

/// Inject the session workspace directory, sandbox config, and env vars into bash tool input.
/// `cwd` replaces the need for process-global `env::set_current_dir()`.
/// Sandbox fields are injected from the chat request config (not from the LLM).
/// Env vars are injected from the chat request for per-session runtime environment.
fn inject_bash_config(
    mut input: Value,
    workspace: &Path,
    sandbox: Option<&crate::chat::SandboxConfigRequest>,
    session_env: Option<&std::collections::HashMap<String, String>>,
) -> Result<Value, String> {
    if let Value::Object(object) = &mut input {
        if !object.contains_key("cwd") {
            object.insert(
                "cwd".to_string(),
                Value::String(workspace.to_string_lossy().into_owned()),
            );
        }
        if let Some(sandbox) = sandbox {
            if let Some(enabled) = sandbox.enabled {
                if !object.contains_key("dangerouslyDisableSandbox") {
                    object.insert(
                        "dangerouslyDisableSandbox".to_string(),
                        Value::Bool(!enabled),
                    );
                }
            }
            if let Some(ns) = sandbox.namespace_restrictions {
                if !object.contains_key("namespaceRestrictions") {
                    object.insert("namespaceRestrictions".to_string(), Value::Bool(ns));
                }
            }
            if let Some(net) = sandbox.network_isolation {
                if !object.contains_key("isolateNetwork") {
                    object.insert("isolateNetwork".to_string(), Value::Bool(net));
                }
            }
            if let Some(ref mode) = sandbox.filesystem_mode {
                if !object.contains_key("filesystemMode") {
                    object.insert("filesystemMode".to_string(), Value::String(mode.clone()));
                }
            }
            if let Some(ref mounts) = sandbox.allowed_mounts {
                if !object.contains_key("allowedMounts") {
                    object.insert(
                        "allowedMounts".to_string(),
                        Value::Array(
                            mounts
                                .iter()
                                .map(|m| Value::String(m.clone()))
                                .collect(),
                        ),
                    );
                }
            }
        }
        if let Some(env_map) = session_env {
            if !env_map.is_empty() && !object.contains_key("env") {
                let env_obj: Map<String, Value> = env_map
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect();
                object.insert("env".to_string(), Value::Object(env_obj));
            }
        }
    }
    Ok(input)
}

/// Normalize a read-path field.  Absolute paths are passed through verbatim
/// (the underlying `file_ops::read_file` canonicalizes them, just like the
/// CLI does).  Relative paths are resolved against the session workspace and
/// must stay inside it.
fn normalize_read_path_field(
    object: &mut Map<String, Value>,
    field: &str,
    workspace: &Path,
) -> Result<(), String> {
    if let Some(Value::String(value)) = object.get_mut(field) {
        let trimmed = value.trim().replace('\\', "/");
        if trimmed.starts_with('/') || (trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':') {
            // Absolute path — pass through; the tool layer will canonicalize.
            *value = trimmed;
        } else {
            // Relative path — resolve inside workspace (same as before).
            let resolved = resolve_existing_workspace_path(workspace, value)?;
            *value = resolved.absolute_path.to_string_lossy().into_owned();
        }
    }
    Ok(())
}


fn normalize_write_path_field(
    object: &mut Map<String, Value>,
    field: &str,
    workspace: &Path,
) -> Result<(), String> {
    if let Some(Value::String(value)) = object.get_mut(field) {
        let trimmed = value.trim().replace('\\', "/");
        if trimmed.starts_with('/') || (trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':') {
            // Absolute path — redirect into workspace to prevent writing to system root.
            // Strip leading path components and keep only the filename.
            let filename = std::path::Path::new(&trimmed)
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| trimmed.clone());
            let resolved = resolve_workspace_write_path(workspace, &filename)?;
            *value = resolved.absolute_path.to_string_lossy().into_owned();
        } else {
            let resolved = resolve_workspace_write_path(workspace, value)?;
            *value = resolved.absolute_path.to_string_lossy().into_owned();
        }
    }
    Ok(())
}

fn validate_glob_pattern_prefix(
    workspace: &Path,
    base_path: &Path,
    pattern: &str,
) -> Result<(), String> {
    let literal_prefix = literal_glob_prefix(pattern);
    if literal_prefix.is_empty() {
        return Ok(());
    }

    let candidate = base_path.join(literal_prefix.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !candidate.exists() {
        return Ok(());
    }

    let canonical_root = canonical_workspace_root(workspace)?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| format!("failed to resolve workspace glob prefix: {error}"))?;

    if canonical_candidate.starts_with(&canonical_root) {
        Ok(())
    } else {
        Err("path must stay inside the session workspace".to_string())
    }
}

fn literal_glob_prefix(pattern: &str) -> String {
    let mut prefix = Vec::new();
    for component in pattern.split('/') {
        if component.is_empty() || component.chars().any(is_glob_meta_char) {
            break;
        }
        prefix.push(component);
    }
    prefix.join("/")
}

fn is_glob_meta_char(ch: char) -> bool {
    matches!(ch, '*' | '?' | '[' | ']' | '{' | '}')
}

fn is_workspace_match(workspace: &Path, candidate: &Path) -> bool {
    let Ok(canonical_root) = canonical_workspace_root(workspace) else {
        return false;
    };
    let Ok(canonical_candidate) = candidate.canonicalize() else {
        return false;
    };
    canonical_candidate.starts_with(&canonical_root)
}


#[derive(Debug, Deserialize)]
struct GlobSearchInputValue {
    pattern: String,
    path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{canonical_tool_name, literal_glob_prefix};
    use crate::state::ActiveTurns;
    use axum::response::sse::Event;
    use runtime::{PermissionMode, ToolExecutor};
    use std::collections::HashMap;
    use std::fs;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    #[test]
    fn canonical_tool_name_maps_lowercase_file_tools() {
        assert_eq!(canonical_tool_name("read_file"), "read_file");
        assert_eq!(canonical_tool_name("write_file"), "write_file");
        assert_eq!(canonical_tool_name("edit_file"), "edit_file");
        assert_eq!(canonical_tool_name("bash"), "bash");
        assert_eq!(canonical_tool_name("ReadFile"), "read_file");
        assert_eq!(canonical_tool_name("WriteFile"), "write_file");
        assert_eq!(canonical_tool_name("EditFile"), "edit_file");
        assert_eq!(canonical_tool_name("Bash"), "bash");
        assert_eq!(canonical_tool_name("WebFetch"), "WebFetch");
        assert_eq!(canonical_tool_name("skills"), "Skill");
        assert_eq!(canonical_tool_name("skill"), "Skill");
        assert_eq!(canonical_tool_name("Skill"), "Skill");
    }

    #[test]
    fn literal_glob_prefix_stops_at_first_glob_component() {
        assert_eq!(literal_glob_prefix("nested/output/*.txt"), "nested/output");
        assert_eq!(literal_glob_prefix("**/*.rs"), "");
        assert_eq!(literal_glob_prefix("reports/{daily,weekly}.md"), "reports");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn web_tool_executor_uses_local_workspace_for_file_tools() {
        let workspace = std::env::temp_dir().join(format!(
            "claw-api-server-local-workspace-test-{}",
            std::process::id()
        ));
        if workspace.exists() {
            fs::remove_dir_all(&workspace).expect("clean test workspace");
        }
        fs::create_dir_all(&workspace).expect("create test workspace");

        let (tx, _rx) = mpsc::channel::<Event>(16);
        let active_turns: ActiveTurns = Arc::new(Mutex::new(HashMap::new()));
        let mut executor = super::WebToolExecutor::new(
            tx,
            "user-1".to_string(),
            "session-1".to_string(),
            active_turns,
            PermissionMode::DangerFullAccess,
            workspace.clone(),
            None,
            None,
            Arc::new(Mutex::new(HashMap::new())),
        );

        executor
            .execute(
                "write_file",
                r#"{"path":"nested/demo.txt","content":"hello from local workspace"}"#,
            )
            .expect("write_file should succeed in session workspace");

        assert_eq!(
            fs::read_to_string(workspace.join("nested/demo.txt")).expect("file was written"),
            "hello from local workspace"
        );

        let output = executor
            .execute("ReadFile", r#"{"path":"/workspace/nested/demo.txt"}"#)
            .expect("ReadFile alias should read from session workspace");

        assert!(output.contains("hello from local workspace"));

        fs::remove_dir_all(&workspace).expect("cleanup test workspace");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn web_tool_executor_rejects_file_path_escape() {
        let root = std::env::temp_dir().join(format!(
            "claw-api-server-escape-test-{}",
            std::process::id()
        ));
        let workspace = root.join("workspace");
        if root.exists() {
            fs::remove_dir_all(&root).expect("clean test root");
        }
        fs::create_dir_all(&workspace).expect("create test workspace");

        let (tx, _rx) = mpsc::channel::<Event>(16);
        let active_turns: ActiveTurns = Arc::new(Mutex::new(HashMap::new()));
        let mut executor = super::WebToolExecutor::new(
            tx,
            "user-1".to_string(),
            "session-1".to_string(),
            active_turns,
            PermissionMode::DangerFullAccess,
            workspace,
            None,
            None,
            Arc::new(Mutex::new(HashMap::new())),
        );

        let error = executor
            .execute(
                "write_file",
                r#"{"path":"../escape.txt","content":"must not escape"}"#,
            )
            .expect_err("path traversal must be rejected");

        assert!(error.to_string().contains("inside the session workspace"));
        assert!(!root.join("escape.txt").exists());

        fs::remove_dir_all(&root).expect("cleanup test root");
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn web_tool_executor_rejects_glob_symlink_escape_prefix() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "claw-api-server-glob-escape-test-{}",
            std::process::id()
        ));
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        if root.exists() {
            fs::remove_dir_all(&root).expect("clean test root");
        }
        fs::create_dir_all(&workspace).expect("create test workspace");
        fs::create_dir_all(&outside).expect("create outside directory");
        symlink(&outside, workspace.join("escape")).expect("create symlink");

        let (tx, _rx) = mpsc::channel::<Event>(16);
        let active_turns: ActiveTurns = Arc::new(Mutex::new(HashMap::new()));
        let mut executor = super::WebToolExecutor::new(
            tx,
            "user-1".to_string(),
            "session-1".to_string(),
            active_turns,
            PermissionMode::DangerFullAccess,
            workspace,
            None,
            None,
            Arc::new(Mutex::new(HashMap::new())),
        );

        let error = executor
            .execute("glob_search", r#"{"pattern":"escape/**/*.txt"}"#)
            .expect_err("glob search should reject escaping symlink prefixes");

        assert!(error.to_string().contains("inside the session workspace"));

        fs::remove_dir_all(&root).expect("cleanup test root");
    }
}
