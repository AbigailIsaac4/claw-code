mod agent_routes;
mod auth;
mod chat;
mod db;
mod runtime_bridge;
mod sandbox_routes;
mod skills;
mod state;
mod workspace;

use axum::extract::DefaultBodyLimit;
use axum::{
    routing::{get, post},
    Router,
};
use state::AppState;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,api_server=debug")),
        )
        .init();

    // 加载 .env 环境变量
    dotenvy::dotenv().ok();

    // 设置全局 skills 搜索根目录，确保 web 模式下 session workspace 之外的 skills 可被发现
    // 优先使用环境变量 CLAW_SKILLS_ROOT，否则自动检测项目根目录下的 assets/skills
    if std::env::var("CLAW_SKILLS_ROOT").is_err() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let candidates = [
            cwd.join("assets").join("skills"),
            cwd.join("..").join("assets").join("skills"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                std::env::set_var("CLAW_SKILLS_ROOT", candidate);
                break;
            }
        }
    }

    if std::env::var("CLAW_WORKSPACE_ROOT").is_err() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        std::env::set_var("CLAW_WORKSPACE_ROOT", cwd.join("data").join("workspaces"));
    }

    // 初始化数据库 (3.1)
    let pool = db::init_db().await.expect("Failed to initialize database");

    let state = AppState::new(pool);

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/v1/auth/register", post(auth::register))
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/chat/completions", post(chat::chat_completions))
        .route("/v1/chat/resolve_action", post(chat::resolve_action))
        .route("/v1/chat/resolve_question", post(chat::resolve_question))
        .route("/v1/sessions", get(chat::list_sessions))
        .route(
            "/v1/sessions/:id",
            get(chat::get_session).delete(chat::delete_session).patch(chat::rename_session),
        )
        .route("/v1/sandbox/upload", post(sandbox_routes::upload_file))
        .route("/v1/sandbox/download", get(sandbox_routes::download_file))
        .route("/v1/sandbox/files", get(sandbox_routes::list_workspace_files))
        .route("/v1/skills", get(skills::list_skills))
        // ── Agent platform routes ──
        // Tasks
        .route("/v1/tasks", get(agent_routes::list_tasks).post(agent_routes::create_task))
        .route(
            "/v1/tasks/:id",
            get(agent_routes::get_task).delete(agent_routes::remove_task),
        )
        .route("/v1/tasks/:id/stop", post(agent_routes::stop_task))
        .route("/v1/tasks/:id/output", get(agent_routes::get_task_output))
        // Workers
        .route("/v1/workers", post(agent_routes::create_worker))
        .route("/v1/workers/:id", get(agent_routes::get_worker))
        .route("/v1/workers/:id/prompt", post(agent_routes::send_worker_prompt))
        .route("/v1/workers/:id/trust", post(agent_routes::resolve_worker_trust))
        .route("/v1/workers/:id/restart", post(agent_routes::restart_worker))
        .route("/v1/workers/:id/terminate", post(agent_routes::terminate_worker))
        // Teams
        .route("/v1/teams", get(agent_routes::list_teams).post(agent_routes::create_team))
        .route(
            "/v1/teams/:id",
            get(agent_routes::get_team).delete(agent_routes::delete_team),
        )
        // Crons
        .route("/v1/crons", get(agent_routes::list_crons).post(agent_routes::create_cron))
        .route(
            "/v1/crons/:id",
            get(agent_routes::get_cron).delete(agent_routes::delete_cron),
        )
        .route("/v1/crons/:id/disable", post(agent_routes::disable_cron))
        // Platform stats
        .route("/v1/stats", get(agent_routes::platform_stats))
        .layer(cors)
        .layer(DefaultBodyLimit::max(150 * 1024 * 1024)) // 150MB limit
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "18008".to_string())
        .parse()
        .unwrap_or(18008);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
