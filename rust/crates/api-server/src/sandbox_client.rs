use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use std::env;
use std::time::Duration;

#[derive(Clone)]
pub struct OpenSandboxClient {
    client: Client,
    base_url: String,
}

#[derive(Serialize)]
pub struct CreateSandboxReq {
    pub user_id: String,
    pub session_id: Option<String>,
    pub image: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateSandboxRes {
    pub sandbox_id: String,
}

#[derive(Serialize)]
pub struct ExecCommandReq {
    pub command: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct ExecCommandRes {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Serialize)]
pub struct WriteFileReq {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct ReadFileReq {
    pub path: String,
}

#[derive(Deserialize)]
pub struct ReadFileRes {
    pub content: String,
}

impl OpenSandboxClient {
    pub fn new() -> Self {
        let base_url = env::var("OPENSANDBOX_URL")
            .unwrap_or_else(|_| "http://10.50.70.91:28080".to_string());
        let api_key = env::var("OPENSANDBOX_API_KEY")
            .unwrap_or_else(|_| "ad9d2a2cf1f26431415c79bd9b84582a769b86ace04c8300be6a23291a74b48a".to_string());

        let mut headers = header::HeaderMap::new();
        headers.insert(
            "Authorization", 
            header::HeaderValue::from_str(&format!("Bearer {}", api_key)).unwrap()
        );

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(5))
            .build()
            .expect("Failed to build OpenSandbox client");

        Self { client, base_url }
    }

    /// 按需创建用户的 Sandbox 实例
    pub async fn create_sandbox(&self, user_id: &str, session_id: Option<String>) -> Result<String, String> {
        let url = format!("{}/v1/sandbox/create", self.base_url);
        let req = CreateSandboxReq {
            user_id: user_id.to_string(),
            session_id,
            image: None,
        };

        let res = self.client.post(&url).json(&req).send().await
            .map_err(|e| e.to_string())?;

        if res.status().is_success() {
            let data: CreateSandboxRes = res.json().await.map_err(|e| e.to_string())?;
            Ok(data.sandbox_id)
        } else {
            Err(format!("Failed to create sandbox: {}", res.status()))
        }
    }

    /// 在特定的 Sandbox 中执行 Bash 命令
    pub async fn execute_bash(&self, sandbox_id: &str, command: &str, timeout_ms: Option<u64>) -> Result<ExecCommandRes, String> {
        let url = format!("{}/v1/sandbox/{}/exec", self.base_url, sandbox_id);
        let req = ExecCommandReq {
            command: command.to_string(),
            timeout_ms,
        };

        let res = self.client.post(&url).json(&req).send().await
            .map_err(|e| e.to_string())?;

        if res.status().is_success() {
            let data: ExecCommandRes = res.json().await.map_err(|e| e.to_string())?;
            Ok(data)
        } else {
            Err(format!("Failed to execute command: {}", res.status()))
        }
    }

    /// 在 Sandbox 中写入文件
    pub async fn write_file(&self, sandbox_id: &str, path: &str, content: &str) -> Result<(), String> {
        let url = format!("{}/v1/sandbox/{}/fs/write", self.base_url, sandbox_id);
        let req = WriteFileReq {
            path: path.to_string(),
            content: content.to_string(),
        };

        let res = self.client.post(&url).json(&req).send().await
            .map_err(|e| e.to_string())?;

        if res.status().is_success() {
            Ok(())
        } else {
            Err(format!("Failed to write file: {}", res.status()))
        }
    }
    
    /// 在 Sandbox 中读取文件
    pub async fn read_file(&self, sandbox_id: &str, path: &str) -> Result<String, String> {
        let url = format!("{}/v1/sandbox/{}/fs/read", self.base_url, sandbox_id);
        let req = ReadFileReq {
            path: path.to_string(),
        };

        let res = self.client.post(&url).json(&req).send().await
            .map_err(|e| e.to_string())?;

        if res.status().is_success() {
            let data: ReadFileRes = res.json().await.map_err(|e| e.to_string())?;
            Ok(data.content)
        } else {
            Err(format!("Failed to read file: {}", res.status()))
        }
    }
}
