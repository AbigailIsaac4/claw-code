use reqwest::Client;
use serde::Serialize;
use std::process;

#[derive(Serialize)]
struct RegisterPayload<'a> {
    email: &'a str,
    password: &'a str,
    full_name: &'a str,
}

#[tokio::main]
async fn main() {
    let users = vec![
        RegisterPayload {
            email: "admin@claw.local",
            password: "password123",
            full_name: "管理员",
        },
        RegisterPayload {
            email: "user1@claw.local",
            password: "password123",
            full_name: "测试用户 1",
        },
        RegisterPayload {
            email: "user2@claw.local",
            password: "password123",
            full_name: "测试用户 2",
        },
    ];

    let client = Client::new();
    let port = std::env::var("PORT").unwrap_or_else(|_| "18008".to_string());
    let api_url = format!("http://127.0.0.1:{}/v1/auth/register", port);

    println!("开始批量注册...");

    for user in users {
        match client.post(api_url).json(&user).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    println!("✅ 成功注册用户: {} ({})", user.email, user.full_name);
                } else {
                    let err_text = response.text().await.unwrap_or_default();
                    println!("❌ 注册失败 {}: {}", user.email, err_text);
                }
            }
            Err(e) => {
                println!("❌ 发生网络错误: {}", e);
                process::exit(1);
            }
        }
    }

    println!("批量注册完成！");
}
