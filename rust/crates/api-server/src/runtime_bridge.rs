use api::{MessageRequest, OpenAiCompatClient};
use axum::response::sse::Event;
use runtime::{ApiClient, ApiRequest, AssistantEvent, PermissionPromptDecision, PermissionPrompter, PermissionRequest, RuntimeError, ToolError, ToolExecutor};
use tokio::sync::{mpsc::Sender, oneshot, Mutex};
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use std::collections::HashMap;
use serde_json::Value;
use tools::GlobalToolRegistry;
use crate::sandbox_client::OpenSandboxClient;

static ACTION_COUNTER: AtomicUsize = AtomicUsize::new(1);

pub struct WebApiClient {
    pub client: OpenAiCompatClient,
    pub tx: Sender<Event>,
}

impl ApiClient for WebApiClient {
    fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        let mut events = Vec::new();

        let mapped_messages = request.messages
            .iter()
            .filter_map(|message| {
                let role = match message.role {
                    runtime::MessageRole::System | runtime::MessageRole::User | runtime::MessageRole::Tool => "user",
                    runtime::MessageRole::Assistant => "assistant",
                };
                let content = message
                    .blocks
                    .iter()
                    .map(|block| match block {
                        runtime::ContentBlock::Text { text } => api::InputContentBlock::Text { text: text.clone() },
                        runtime::ContentBlock::ToolUse { id, name, input } => api::InputContentBlock::ToolUse {
                            id: id.clone(),
                            name: name.clone(),
                            input: serde_json::from_str(input)
                                .unwrap_or_else(|_| serde_json::json!({ "raw": input })),
                        },
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
                                    api::OutputContentBlock::Text { text } => {
                                        if !text.is_empty() {
                                            let _ = self.tx.send(Event::default().event("message").data(text.clone())).await;
                                            events.push(AssistantEvent::TextDelta(text));
                                        }
                                    }
                                    api::OutputContentBlock::ToolUse { id, name, input } => {
                                        let input_str = if input.is_string() {
                                            input.as_str().unwrap().to_string()
                                        } else {
                                            input.to_string()
                                        };
                                        events.push(AssistantEvent::ToolUse { id, name, input: input_str });
                                    }
                                    _ => {}
                                }
                            }
                        }
                        api::StreamEvent::ContentBlockStart(start) => {
                            if let api::OutputContentBlock::ToolUse { id, name, input } = start.content_block {
                                let input_str = if input.is_string() {
                                    input.as_str().unwrap().to_string()
                                } else {
                                    input.to_string()
                                };
                                pending_tool = Some((id, name, input_str));
                            }
                        }
                        api::StreamEvent::ContentBlockDelta(delta) => {
                            match delta.delta {
                                api::ContentBlockDelta::TextDelta { text } => {
                                    if !text.is_empty() {
                                        let _ = self.tx.send(Event::default().event("message").data(text.clone())).await;
                                        events.push(AssistantEvent::TextDelta(text));
                                    }
                                }
                                api::ContentBlockDelta::InputJsonDelta { partial_json } => {
                                    if let Some((_, _, ref mut input)) = pending_tool {
                                        input.push_str(&partial_json);
                                    }
                                }
                                _ => {}
                            }
                        }
                        api::StreamEvent::ContentBlockStop(_) => {
                            if let Some((id, name, input)) = pending_tool.take() {
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
    pub user_id: String,
    pub session_id: String,
    pub sandbox_id: Option<String>,
    pub tool_registry: GlobalToolRegistry,
    /// 连续 bash 错误计数器 — 防止 agent loop 无限重试沙箱命令
    consecutive_bash_errors: u32,
}

const MAX_CONSECUTIVE_BASH_ERRORS: u32 = 3;

impl WebToolExecutor {
    pub fn new(tx: Sender<Event>, user_id: String, session_id: String, sandbox_client: OpenSandboxClient) -> Self {
        Self {
            tx,
            sandbox_client,
            user_id,
            session_id,
            sandbox_id: None,
            tool_registry: GlobalToolRegistry::builtin(),
            consecutive_bash_errors: 0,
        }
    }

    async fn ensure_sandbox(&mut self) -> Result<String, String> {
        if let Some(ref id) = self.sandbox_id {
            return Ok(id.clone());
        }
        let id = self.sandbox_client.create_sandbox(&self.user_id, Some(self.session_id.clone())).await?;
        self.sandbox_id = Some(id.clone());
        Ok(id)
    }
}

#[derive(serde::Deserialize)]
struct BashInput { command: String, timeout: Option<u64> }
#[derive(serde::Deserialize)]
struct ReadFileInput { path: String }
#[derive(serde::Deserialize)]
struct WriteFileInput { path: String, content: String }

impl ToolExecutor for WebToolExecutor {
    fn execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError> {
        // 运行工具时的副作用：通知前端进入工具执行状态
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let sse_data = serde_json::to_string(&serde_json::json!({
                    "tool": tool_name,
                    "input": input
                })).unwrap_or_default();
                let _ = self.tx.send(
                    Event::default().event("tool_call_start").data(sse_data)
                ).await;
            });
        });

        let value: Value = serde_json::from_str(input)
            .map_err(|e| ToolError::new(format!("Invalid input JSON: {}", e)))?;

        let result: Result<String, String> = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                match tool_name {
                    "Bash" | "bash" => {
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
                                return Err(format!("沙箱创建失败 (第{}次连续错误): {}", self.consecutive_bash_errors, e));
                            }
                        };
                        let req: BashInput = serde_json::from_str(input).map_err(|e| e.to_string())?;
                        match self.sandbox_client.execute_bash(&sandbox_id, &req.command, req.timeout).await {
                            Ok(res) => {
                                // 成功执行，重置连续错误计数
                                self.consecutive_bash_errors = 0;
                                let return_code_interpretation = if res.exit_code == 0 { None } else { Some(format!("exit_code:{}", res.exit_code)) };
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
                                }
                                Err(format!("命令执行失败 (第{}次连续错误): {}", self.consecutive_bash_errors, e))
                            }
                        }
                    }
                    "ReadFile" => {
                        let base_dir = std::env::var("WORKSPACE_BASE_DIR").unwrap_or_else(|_| "./data/workspaces".to_string());
                        let workspace_dir = std::path::Path::new(&base_dir).join(&self.user_id).join(&self.session_id);
                        let req: ReadFileInput = serde_json::from_str(input).map_err(|e| e.to_string())?;
                        
                        let filename = req.path.strip_prefix("/workspace/").unwrap_or(&req.path);
                        let file_path = workspace_dir.join(filename);
                        
                        let content = tokio::fs::read_to_string(&file_path).await
                            .map_err(|e| format!("Failed to read file locally: {}", e))?;
                        Ok(serde_json::to_string_pretty(&content).unwrap_or_default())
                    }
                    "WriteFile" => {
                        let base_dir = std::env::var("WORKSPACE_BASE_DIR").unwrap_or_else(|_| "./data/workspaces".to_string());
                        let workspace_dir = std::path::Path::new(&base_dir).join(&self.user_id).join(&self.session_id);
                        let req: WriteFileInput = serde_json::from_str(input).map_err(|e| e.to_string())?;
                        
                        let filename = req.path.strip_prefix("/workspace/").unwrap_or(&req.path);
                        let file_path = workspace_dir.join(filename);
                        
                        if let Some(parent) = file_path.parent() {
                            tokio::fs::create_dir_all(parent).await.unwrap_or_default();
                        }
                        
                        tokio::fs::write(&file_path, &req.content).await
                            .map_err(|e| format!("Failed to write file locally: {}", e))?;
                        let content = "File written successfully.";
                        Ok(serde_json::to_string_pretty(&content).unwrap_or_default())
                    }
                    _ => {
                        // 回退到 tools::lib 原生执行
                        self.tool_registry.execute(tool_name, &value).map_err(|e| e.to_string()).and_then(|v| {
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
                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "result": output
                        })).unwrap_or_default();
                        let _ = self.tx.send(
                            Event::default().event("tool_call_result").data(sse_data)
                        ).await;
                    });
                });
            }
            Err(e) => {
                tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(async {
                        let sse_data = serde_json::to_string(&serde_json::json!({
                            "tool": tool_name,
                            "error": e.to_string()
                        })).unwrap_or_default();
                        let _ = self.tx.send(
                            Event::default().event("tool_call_result").data(sse_data)
                        ).await;
                    });
                });
            }
        }

        result.map_err(|e| ToolError::new(e))
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
                })).unwrap_or_default();
                self.tx.send(
                    Event::default().event("action_required").data(sse_data)
                ).await
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
                reason: "Client disconnected. Auto-denied to prevent blocking background execution.".to_string(),
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
