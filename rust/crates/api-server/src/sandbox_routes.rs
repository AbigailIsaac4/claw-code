use crate::auth::AuthUser;
use crate::state::AppState;
use crate::workspace::{
    resolve_existing_workspace_path, resolve_workspace_write_path, session_workspace,
};
use axum::{
    extract::{Multipart, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

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
                "session_id is required for workspace file operations".to_string(),
            )
        })
}

pub async fn upload_file(
    user: AuthUser,
    State(_state): State<AppState>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let session_id = require_session_id(&query.session_id)?;
    let workspace = session_workspace(&user.user_id, &session_id)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
    tokio::fs::create_dir_all(&workspace)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create workspace: {error}"),
            )
        })?;

    let mut uploaded_files = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?
    {
        let file_name = field.file_name().unwrap_or("unnamed").to_string();
        let workspace_path = resolve_workspace_write_path(&workspace, &file_name)
            .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
        let data = field
            .bytes()
            .await
            .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

        if let Some(parent) = workspace_path.absolute_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create upload directory: {error}"),
                )
            })?;
        }
        tokio::fs::write(&workspace_path.absolute_path, &data)
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write upload file: {error}"),
                )
            })?;
        uploaded_files.push(workspace_path.relative_path);
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
    let session_id = require_session_id(&query.session_id)?;
    let workspace = session_workspace(&user.user_id, &session_id)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
    let workspace_path = resolve_existing_workspace_path(&workspace, &query.path)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))?;

    let decoded = tokio::fs::read(&workspace_path.absolute_path)
        .await
        .map_err(|error| (StatusCode::NOT_FOUND, format!("File not found: {error}")))?;

    let content_type = if workspace_path.relative_path.ends_with(".png") {
        "image/png"
    } else if workspace_path.relative_path.ends_with(".jpg")
        || workspace_path.relative_path.ends_with(".jpeg")
    {
        "image/jpeg"
    } else if workspace_path.relative_path.ends_with(".gif") {
        "image/gif"
    } else if workspace_path.relative_path.ends_with(".svg") {
        "image/svg+xml"
    } else if workspace_path.relative_path.ends_with(".webp") {
        "image/webp"
    } else if workspace_path.relative_path.ends_with(".pdf") {
        "application/pdf"
    } else if workspace_path.relative_path.ends_with(".html")
        || workspace_path.relative_path.ends_with(".htm")
    {
        "text/html; charset=utf-8"
    } else if workspace_path.relative_path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if workspace_path.relative_path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if workspace_path.relative_path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if workspace_path.relative_path.ends_with(".csv") {
        "text/csv; charset=utf-8"
    } else if workspace_path.relative_path.ends_with(".md")
        || workspace_path.relative_path.ends_with(".txt")
        || workspace_path.relative_path.ends_with(".py")
        || workspace_path.relative_path.ends_with(".sh")
        || workspace_path.relative_path.ends_with(".rs")
        || workspace_path.relative_path.ends_with(".ts")
        || workspace_path.relative_path.ends_with(".xml")
        || workspace_path.relative_path.ends_with(".yaml")
        || workspace_path.relative_path.ends_with(".yml")
    {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    };

    let filename = workspace_path
        .relative_path
        .rsplit('/')
        .next()
        .unwrap_or("download");

    // Use inline disposition for previewable types, attachment for binary downloads
    let disposition = if content_type.starts_with("text/")
        || content_type.starts_with("image/")
        || content_type.starts_with("application/pdf")
        || content_type.starts_with("application/json")
    {
        format!("inline; filename=\"{}\"", filename)
    } else {
        format!("attachment; filename=\"{}\"", filename)
    };

    use axum::http::header;
    let headers = [
        (header::CONTENT_TYPE, content_type.to_string()),
        (header::CONTENT_DISPOSITION, disposition),
    ];

    Ok((headers, decoded))
}

#[derive(Deserialize)]
pub struct ListFilesQuery {
    pub session_id: Option<String>,
    pub path: Option<String>,
}

/// List files in a session workspace directory.
/// Returns a flat list of file entries with name, relative path, size, and type.
pub async fn list_workspace_files(
    user: AuthUser,
    State(_state): State<AppState>,
    Query(query): Query<ListFilesQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let session_id = require_session_id(&query.session_id)?;
    let workspace = session_workspace(&user.user_id, &session_id)
        .map_err(|error| (StatusCode::BAD_REQUEST, error))?;

    // Resolve subdirectory if specified, otherwise use workspace root
    let target_dir = if let Some(ref subpath) = query.path {
        let resolved = resolve_existing_workspace_path(&workspace, subpath)
            .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
        if resolved.absolute_path.is_dir() {
            resolved.absolute_path
        } else {
            return Ok(Json(json!({
                "files": [{
                    "name": resolved.relative_path.rsplit('/').next().unwrap_or(&resolved.relative_path),
                    "path": resolved.relative_path,
                    "is_dir": false,
                    "size": tokio::fs::metadata(&resolved.absolute_path)
                        .await
                        .map(|m| m.len())
                        .unwrap_or(0),
                }]
            })));
        }
    } else {
        // Check if workspace exists; if not, return empty
        if !workspace.exists() {
            return Ok(Json(json!({"files": []})));
        }
        workspace.clone()
    };

    let mut entries = Vec::new();
    let mut dirs_to_visit = vec![target_dir.clone()];

    while let Some(current_dir) = dirs_to_visit.pop() {
        let mut dir = match tokio::fs::read_dir(&current_dir).await {
            Ok(d) => d,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = dir.next_entry().await {
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let metadata = entry.metadata().await.ok();
            let name = entry.file_name().to_string_lossy().into_owned();

            // Skip hidden files and sandbox internals
            if name.starts_with('.') {
                continue;
            }

            let full_path = entry.path();

            if file_type.is_dir() {
                dirs_to_visit.push(full_path.clone());
            }

            // Compute relative path from workspace root
            let relative_path = full_path
                .strip_prefix(&workspace)
                .unwrap_or(&full_path)
                .to_string_lossy()
                .into_owned()
                .replace('\\', "/");

            entries.push(json!({
                "name": name,
                "path": relative_path,
                "is_dir": file_type.is_dir(),
                "size": metadata.map(|m| m.len()).unwrap_or(0),
            }));
        }
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        let a_is_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_is_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_is_dir
            .cmp(&a_is_dir)
            .then_with(|| {
                a["name"]
                    .as_str()
                    .unwrap_or("")
                    .cmp(b["name"].as_str().unwrap_or(""))
            })
    });

    Ok(Json(json!({ "files": entries })))
}
