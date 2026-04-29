use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;
use std::time::Duration;

#[derive(Clone)]
pub struct OpenSandboxClient {
    client: Client,
    /// Lifecycle API base URL, e.g. "http://10.50.70.91:28080/v1"
    base_url: String,
}

// ─────────────────────── Create Sandbox ───────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSandboxReq {
    image: ImageSpec,
    resource_limits: ResourceLimits,
    entrypoint: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct ImageSpec {
    uri: String,
}

#[derive(Serialize)]
struct ResourceLimits {
    cpu: String,
    memory: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSandboxRes {
    #[serde(alias = "sandboxId", alias = "sandbox_id", alias = "id")]
    sandbox_id: String,
}

// ─────────────────────── Endpoint Resolution ───────────────────────

#[derive(Deserialize)]
struct EndpointRes {
    #[serde(alias = "url")]
    endpoint: String,
}

// ─────────────────────── Command Execution ───────────────────────

#[derive(Serialize)]
struct RunCommandReq {
    command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    envs: Option<std::collections::HashMap<String, String>>,
}

/// Parsed result from SSE stream of command execution
pub struct ExecCommandRes {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl OpenSandboxClient {
    pub fn new() -> Self {
        let raw_url = env::var("OPENSANDBOX_URL")
            .or_else(|_| env::var("OPENSANDBOX_API_URL"))
            .unwrap_or_else(|_| "http://10.50.70.91:28080".to_string());
        let raw_url = raw_url.trim_end_matches('/').to_string();

        // base_url = "{protocol}://{domain}/v1"
        let base_url = if raw_url.ends_with("/v1") {
            raw_url.clone()
        } else {
            format!("{}/v1", raw_url)
        };

        let api_key = env::var("OPENSANDBOX_API_KEY")
            .or_else(|_| env::var("OPEN_SANDBOX_API_KEY"))
            .unwrap_or_default();

        let mut headers = header::HeaderMap::new();
        // OpenSandbox uses a custom header, NOT "Authorization: Bearer ..."
        headers.insert(
            "OPEN-SANDBOX-API-KEY",
            header::HeaderValue::from_str(&api_key).unwrap_or_else(|_| header::HeaderValue::from_static("")),
        );

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(120)) // sandbox ops can be slow
            .build()
            .expect("Failed to build OpenSandbox client");

        Self { client, base_url }
    }

    // ────────── Lifecycle: Create ──────────

    /// Create a new sandbox container and wait for it to become ready.
    /// Returns `sandbox_id`.
    pub async fn create_sandbox(&self, user_id: &str, session_id: Option<String>) -> Result<String, String> {
        let template = env::var("SANDBOX_TEMPLATE").unwrap_or_else(|_| "base".to_string());
        let timeout_secs: u64 = env::var("SANDBOX_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(4200); // 70 minutes default

        let mut metadata = serde_json::Map::new();
        metadata.insert("user_id".into(), serde_json::Value::String(user_id.to_string()));
        if let Some(sid) = &session_id {
            metadata.insert("session_id".into(), serde_json::Value::String(sid.clone()));
        }

        let url = format!("{}/sandboxes", self.base_url);
        let req = CreateSandboxReq {
            image: ImageSpec { uri: template },
            resource_limits: ResourceLimits {
                cpu: "1".to_string(),
                memory: "2Gi".to_string(),
            },
            entrypoint: vec!["tail".into(), "-f".into(), "/dev/null".into()],
            timeout: Some(timeout_secs),
            metadata: if metadata.is_empty() { None } else { Some(Value::Object(metadata)) },
        };

        tracing::info!("Creating sandbox: POST {}", url);
        let res = self.client.post(&url).json(&req).send().await
            .map_err(|e| format!("Sandbox create request failed: {}", e))?;

        let status = res.status();
        if !status.is_success() && status.as_u16() != 202 {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Failed to create sandbox (HTTP {}): {}", status, body));
        }

        let data: CreateSandboxRes = res.json().await
            .map_err(|e| format!("Failed to parse sandbox creation response: {}", e))?;

        tracing::info!("Sandbox created: {}", data.sandbox_id);

        // Wait for sandbox to be healthy (simple retry with ping). Reduced to 15 (30s) to fail fast.
        self.wait_for_ready(&data.sandbox_id, 15).await?;

        Ok(data.sandbox_id)
    }

    // ────────── Lifecycle: Resolve execd endpoint ──────────

    /// Get the execd proxy endpoint URL for a sandbox.
    /// When `use_server_proxy=true`, the server acts as a reverse proxy to the sandbox's execd.
    async fn get_execd_url(&self, sandbox_id: &str) -> Result<String, String> {
        // We use use_server_proxy=false to get the direct host mapped port.
        // The sandbox server (especially with runsc/gVisor) often fails to connect to the internal container IP (172.17.0.x),
        // resulting in a 502 Bad Gateway when use_server_proxy=true.
        // By connecting to the mapped host port directly, we bypass the internal routing issues.
        let url = format!(
            "{}/sandboxes/{}/endpoints/8080?use_server_proxy=false",
            self.base_url, sandbox_id
        );
        tracing::debug!("Resolving execd endpoint: GET {}", url);

        let res = self.client.get(&url).send().await
            .map_err(|e| format!("Failed to resolve execd endpoint: {}", e))?;

        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Failed to get execd endpoint (HTTP {}): {}", status, body));
        }

        let endpoint: EndpointRes = res.json().await
            .map_err(|e| format!("Failed to parse endpoint response: {}", e))?;

        // endpoint is usually like "10.0.0.12:43555" or "0.0.0.0:43555".
        // If api-server is running on a different machine (e.g. Windows), it cannot reach 10.0.0.12 or 0.0.0.0.
        // We extract the port and combine it with the known reachable host of self.base_url.
        let parsed_base = reqwest::Url::parse(&self.base_url)
            .map_err(|e| format!("Invalid base_url: {}", e))?;
        
        let port = endpoint.endpoint.split(':').last().unwrap_or(&endpoint.endpoint);
        
        let final_url = format!("{}://{}:{}", parsed_base.scheme(), parsed_base.host_str().unwrap_or("127.0.0.1"), port);
        
        tracing::debug!("Rewrote returned endpoint {} to {}", endpoint.endpoint, final_url);

        Ok(final_url)
    }

    // ────────── Execd: Health Check ──────────

    async fn wait_for_ready(&self, sandbox_id: &str, max_attempts: u32) -> Result<(), String> {
        for attempt in 1..=max_attempts {
            match self.get_execd_url(sandbox_id).await {
                Ok(execd_url) => {
                    // Try a health ping
                    let health_url = format!("{}/ping", execd_url.trim_end_matches('/'));
                    match self.client.get(&health_url)
                        .timeout(Duration::from_secs(5))
                        .send().await
                    {
                        Ok(r) if r.status().is_success() => {
                            tracing::info!("Sandbox {} is ready (attempt {})", sandbox_id, attempt);
                            return Ok(());
                        }
                        Ok(r) => {
                            let status = r.status();
                            let body = r.text().await.unwrap_or_default();
                            if attempt % 10 == 1 {
                                tracing::info!("Sandbox {} health check attempt {}/{}: HTTP {} - {}", sandbox_id, attempt, max_attempts, status, &body[..body.len().min(120)]);
                            }
                        }
                        Err(e) => {
                            if attempt % 10 == 1 {
                                tracing::info!("Sandbox {} health check attempt {}/{}: {}", sandbox_id, attempt, max_attempts, e);
                            }
                        }
                    }
                }
                Err(e) => {
                    if attempt % 10 == 1 {
                        tracing::warn!("Sandbox {} endpoint resolution failed (attempt {}/{}): {}", sandbox_id, attempt, max_attempts, e);
                    }
                }
            }

            if attempt < max_attempts {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
        Err(format!("Sandbox {} did not become ready after {} attempts (~{}s)", sandbox_id, max_attempts, max_attempts * 2))
    }

    // ────────── Execd: Execute Command ──────────

    /// Execute a bash command inside the sandbox via the execd API.
    /// The execd endpoint returns SSE-streamed output.
    pub async fn execute_bash(
        &self,
        sandbox_id: &str,
        command: &str,
        timeout_ms: Option<u64>,
    ) -> Result<ExecCommandRes, String> {
        let execd_url = self.get_execd_url(sandbox_id).await?;
        let cmd_url = format!("{}/command", execd_url.trim_end_matches('/'));

        let mut envs = std::collections::HashMap::new();
        if let Ok(key) = env::var("ANTHROPIC_API_KEY") {
            envs.insert("ANTHROPIC_API_KEY".to_string(), key);
        }
        if let Ok(url) = env::var("ANTHROPIC_BASE_URL") {
            envs.insert("ANTHROPIC_BASE_URL".to_string(), url);
        }
        if let Ok(key) = env::var("OPENAI_API_KEY") {
            envs.insert("OPENAI_API_KEY".to_string(), key);
        }
        if let Ok(url) = env::var("OPENAI_BASE_URL") {
            envs.insert("OPENAI_BASE_URL".to_string(), url);
        }
        if let Ok(model) = env::var("OPENAI_MODEL_NAME") {
            envs.insert("OPENAI_MODEL_NAME".to_string(), model);
        }

        let req = RunCommandReq {
            command: command.to_string(),
            cwd: Some("/workspace".to_string()),
            timeout: timeout_ms,
            envs: if envs.is_empty() { None } else { Some(envs) },
        };

        tracing::debug!("Executing command in sandbox {}: {}", sandbox_id, command);

        let res = self.client.post(&cmd_url)
            .json(&req)
            .timeout(Duration::from_secs(timeout_ms.map(|ms| ms / 1000 + 10).unwrap_or(600)))
            .send().await
            .map_err(|e| format!("Command execution request failed: {}", e))?;

        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Command execution failed (HTTP {}): {}", status, body));
        }

        // Parse SSE stream from response body
        let body = res.text().await.unwrap_or_default();
        self.parse_command_sse(&body)
    }

    /// Parse the SSE response from the execd /command endpoint.
    ///
    /// The execd service sends `data:` lines with self-describing JSON events:
    ///   data: {"type":"stdout","text":"...","timestamp":1234}
    ///   data: {"type":"stderr","text":"...","timestamp":1234}
    ///   data: {"type":"error","error":{"name":"...","value":"1","traceback":"..."},"timestamp":1234}
    ///   data: {"type":"execution_complete","timestamp":1234}
    ///
    /// Also supports standard SSE format (event:/data: pairs) as fallback.
    fn parse_command_sse(&self, body: &str) -> Result<ExecCommandRes, String> {
        let mut stdout_parts: Vec<String> = Vec::new();
        let mut stderr_parts: Vec<String> = Vec::new();
        let mut exit_code: i32 = 0; // default success if no error event
        let mut got_error = false;
        let mut got_complete = false;

        // Fallback: track event: lines for standard SSE format
        let mut current_event = String::new();

        for line in body.lines() {
            let line = line.trim();
            if line.is_empty() {
                current_event.clear();
                continue;
            }

            if line.starts_with("event:") {
                current_event = line.trim_start_matches("event:").trim().to_string();
                continue;
            }

            // Skip non-data lines (comments, id:, retry:)
            if !line.starts_with("data:") {
                continue;
            }

            let data_str = line.trim_start_matches("data:").trim();
            if data_str.is_empty() {
                continue;
            }

            let Ok(v) = serde_json::from_str::<Value>(data_str) else {
                tracing::debug!("Skipping unparseable SSE data: {}", &data_str[..data_str.len().min(100)]);
                continue;
            };

            // Determine event type: prefer "type" field in JSON, fall back to event: line
            let event_type = v.get("type")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| current_event.clone());

            match event_type.as_str() {
                "stdout" => {
                    if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                        stdout_parts.push(text.to_string());
                    }
                }
                "stderr" => {
                    if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                        stderr_parts.push(text.to_string());
                    }
                }
                "error" => {
                    got_error = true;
                    // Exit code from error.value (SDK pattern)
                    if let Some(err_obj) = v.get("error") {
                        if let Some(val) = err_obj.get("value").and_then(|v| v.as_str()) {
                            exit_code = val.parse::<i32>().unwrap_or(1);
                        } else {
                            exit_code = 1;
                        }
                        if let Some(tb) = err_obj.get("traceback").and_then(|t| t.as_str()) {
                            stderr_parts.push(tb.to_string());
                        }
                    } else {
                        exit_code = 1;
                    }
                }
                "result" | "complete" => {
                    // Legacy format: {"exitCode": 0}
                    if let Some(code) = v.get("exitCode").or(v.get("exit_code")).and_then(|c| c.as_i64()) {
                        exit_code = code as i32;
                    }
                }
                "execution_complete" => {
                    got_complete = true;
                    // Successful completion with no error means exit_code = 0
                }
                "init" | "execution_count" => {
                    // Informational, skip
                }
                _ => {
                    tracing::debug!("Unknown execd SSE event type: {}", event_type);
                }
            }
        }

        // If we got neither an explicit error nor a completion event, and there's
        // no stdout/stderr at all, the command may have failed silently
        if !got_error && !got_complete && stdout_parts.is_empty() && stderr_parts.is_empty() {
            tracing::warn!("No output events received from execd; raw body length = {}", body.len());
        }

        Ok(ExecCommandRes {
            stdout: stdout_parts.join(""),
            stderr: stderr_parts.join(""),
            exit_code,
        })
    }

    // ────────── Lifecycle: Renew Expiration ──────────

    /// Extend the sandbox lifetime.
    #[allow(dead_code)]
    pub async fn renew_sandbox(&self, sandbox_id: &str, timeout_secs: u64) -> Result<(), String> {
        let url = format!("{}/sandboxes/{}/renew-expiration", self.base_url, sandbox_id);
        let new_expiration = chrono::Utc::now() + chrono::Duration::seconds(timeout_secs as i64);

        let body = serde_json::json!({
            "expiresAt": new_expiration.to_rfc3339()
        });

        let res = self.client.post(&url).json(&body).send().await
            .map_err(|e| format!("Renew sandbox failed: {}", e))?;

        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Renew sandbox failed (HTTP {}): {}", status, body));
        }

        Ok(())
    }

    // ────────── Lifecycle: Kill ──────────

    /// Terminate a sandbox.
    #[allow(dead_code)]
    pub async fn kill_sandbox(&self, sandbox_id: &str) -> Result<(), String> {
        let url = format!("{}/sandboxes/{}", self.base_url, sandbox_id);

        let res = self.client.delete(&url).send().await
            .map_err(|e| format!("Kill sandbox failed: {}", e))?;

        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Kill sandbox failed (HTTP {}): {}", status, body));
        }

        Ok(())
    }
}
