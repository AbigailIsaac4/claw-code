use crate::auth::AuthUser;
use crate::sandbox_client::sanitize_workspace_path;
use crate::state::AppState;
use axum::{
    extract::{Multipart, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct DownloadQuery {
    path: String,
    session_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UploadQuery {
    session_id: Option<String>,
}

fn require_session_id(session_id: &Option<String>) -> Result<String, (StatusCode, String)> {
    session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "session_id is required for sandbox file operations".to_string(),
            )
        })
}

pub async fn upload_file(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let session_id = require_session_id(&query.session_id)?;
    let sandbox_id = state
        .ensure_sandbox_id(&user.user_id, &session_id)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to create sandbox: {e}"),
            )
        })?;

    let mut uploaded_files = vec![];

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let file_name = field.file_name().unwrap_or("unnamed").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

        let remote_path = state
            .sandbox_client
            .upload_file_bytes(&sandbox_id, &file_name, &data)
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Failed to upload file to sandbox: {e}"),
                )
            })?;
        uploaded_files.push(remote_path);
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "files": uploaded_files
    })))
}

pub async fn download_file(
    user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<DownloadQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let session_id = require_session_id(&query.session_id)?;
    let workspace_path =
        sanitize_workspace_path(&query.path).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let sandbox_id = state
        .ensure_sandbox_id(&user.user_id, &session_id)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Failed to create sandbox: {e}"),
            )
        })?;

    let decoded = state
        .sandbox_client
        .download_file_bytes(&sandbox_id, &workspace_path.remote_path)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                format!("File not found in sandbox: {e}"),
            )
        })?;

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

    let filename_str = workspace_path
        .relative_path
        .rsplit('/')
        .next()
        .unwrap_or("download");

    use axum::http::header;
    let headers = [
        (header::CONTENT_TYPE, content_type.to_string()),
        (
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename_str),
        ),
    ];

    Ok((headers, decoded))
}
