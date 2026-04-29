use axum::{
    extract::{Multipart, State, Query},
    Json,
    response::IntoResponse,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use crate::state::AppState;
use crate::auth::AuthUser;
use base64::{Engine as _, engine::general_purpose::STANDARD as b64};

#[derive(Deserialize)]
pub struct DownloadQuery {
    path: String,
    session_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UploadQuery {
    session_id: Option<String>,
}

pub async fn upload_file(
    user: AuthUser,
    State(_state): State<AppState>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let session_id = query.session_id.clone().unwrap_or_else(|| "default".to_string());
    let base_dir = std::env::var("WORKSPACE_BASE_DIR").unwrap_or_else(|_| "./data/workspaces".to_string());
    let workspace_dir = std::path::Path::new(&base_dir).join(&user.user_id).join(&session_id);

    tokio::fs::create_dir_all(&workspace_dir).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create workspace: {}", e)))?;

    let mut uploaded_files = vec![];

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let file_name = field.file_name().unwrap_or("unnamed").to_string();
        let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        
        let file_path = workspace_dir.join(&file_name);
        tokio::fs::write(&file_path, data).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write file: {}", e)))?;
            
        let remote_path = format!("/workspace/{}", file_name);
        uploaded_files.push(remote_path);
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "files": uploaded_files
    })))
}

pub async fn download_file(
    user: AuthUser,
    State(_state): State<AppState>,
    Query(query): Query<DownloadQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let session_id = query.session_id.clone().unwrap_or_else(|| "default".to_string());
    let base_dir = std::env::var("WORKSPACE_BASE_DIR").unwrap_or_else(|_| "./data/workspaces".to_string());
    
    // The path from frontend might be `/workspace/filename.txt`
    let filename = query.path.strip_prefix("/workspace/").unwrap_or(&query.path);
    let file_path = std::path::Path::new(&base_dir).join(&user.user_id).join(&session_id).join(filename);

    let decoded = tokio::fs::read(&file_path).await
        .map_err(|e| (StatusCode::NOT_FOUND, format!("File not found locally: {}", e)))?;

    // Guess content type
    let content_type = if query.path.ends_with(".png") {
        "image/png"
    } else if query.path.ends_with(".jpg") || query.path.ends_with(".jpeg") {
        "image/jpeg"
    } else if query.path.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    };

    let filename_str = file_path.file_name().unwrap_or_default().to_string_lossy();

    use axum::http::header;
    let headers = [
        (header::CONTENT_TYPE, content_type.to_string()),
        (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename_str)),
    ];

    Ok((headers, decoded))
}
