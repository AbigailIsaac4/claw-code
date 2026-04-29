mod chat;
mod state;
mod runtime_bridge;
mod db;
mod auth;
mod sandbox_client;
mod sandbox_routes;
mod skills;

use axum::{
    routing::{get, post, delete},
    Router,
};
use state::AppState;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    
    // 初始化数据库 (3.1)
    let pool = db::init_db().await.expect("Failed to initialize database");
    
    let state = AppState::new(pool);

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::DELETE, axum::http::Method::OPTIONS])
        .allow_headers([axum::http::header::CONTENT_TYPE, axum::http::header::AUTHORIZATION]);

    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/v1/auth/register", post(auth::register))
        .route("/v1/auth/login", post(auth::login))
        .route("/v1/chat/completions", post(chat::chat_completions))
        .route("/v1/chat/resolve_action", post(chat::resolve_action))
        .route("/v1/sessions", get(chat::list_sessions))
        .route("/v1/sessions/:id", get(chat::get_session).delete(chat::delete_session))
        .route("/v1/sandbox/upload", post(sandbox_routes::upload_file))
        .route("/v1/sandbox/download", get(sandbox_routes::download_file))
        .route("/v1/skills", get(skills::list_skills))
        .layer(cors)
        .with_state(state);

    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string()).parse().unwrap_or(3000);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Server listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
