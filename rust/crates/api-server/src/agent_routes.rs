use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthUser;

// ── Task endpoints ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateTaskRequest {
    pub prompt: String,
    pub description: Option<String>,
}

#[derive(Serialize)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub prompt: String,
    pub description: Option<String>,
    pub team_id: Option<String>,
    pub output: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl From<runtime::task_registry::Task> for TaskResponse {
    fn from(t: runtime::task_registry::Task) -> Self {
        Self {
            task_id: t.task_id,
            status: format!("{}", t.status),
            prompt: t.prompt,
            description: t.description,
            team_id: t.team_id,
            output: t.output,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

pub async fn create_task(
    _user: AuthUser,
    Json(payload): Json<CreateTaskRequest>,
) -> Json<TaskResponse> {
    let registry = tools::task_registry();
    let task = registry.create(&payload.prompt, payload.description.as_deref());
    Json(task.into())
}

pub async fn list_tasks(
    _user: AuthUser,
) -> Json<Vec<TaskResponse>> {
    let registry = tools::task_registry();
    let tasks = registry.list(None);
    Json(tasks.into_iter().map(TaskResponse::from).collect())
}

pub async fn get_task(
    _user: AuthUser,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<TaskResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::task_registry();
    let task = registry
        .get(&task_id)
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, format!("task not found: {task_id}")))?;
    Ok(Json(task.into()))
}

pub async fn stop_task(
    _user: AuthUser,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<TaskResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::task_registry();
    let task = registry
        .stop(&task_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(task.into()))
}

pub async fn get_task_output(
    _user: AuthUser,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let registry = tools::task_registry();
    let output = registry
        .output(&task_id)
        .map_err(|e| (axum::http::StatusCode::NOT_FOUND, e))?;
    Ok(Json(serde_json::json!({"task_id": task_id, "output": output})))
}

pub async fn remove_task(
    _user: AuthUser,
    axum::extract::Path(task_id): axum::extract::Path<String>,
) -> Result<Json<TaskResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::task_registry();
    let task = registry
        .remove(&task_id)
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, format!("task not found: {task_id}")))?;
    Ok(Json(task.into()))
}

// ── Worker endpoints ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWorkerRequest {
    pub cwd: Option<String>,
    pub trusted_roots: Option<Vec<String>>,
    pub auto_recover_prompt_misdelivery: Option<bool>,
}

#[derive(Serialize)]
pub struct WorkerResponse {
    pub worker_id: String,
    pub status: String,
    pub cwd: String,
    pub events_count: usize,
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl From<runtime::worker_boot::Worker> for WorkerResponse {
    fn from(w: runtime::worker_boot::Worker) -> Self {
        Self {
            worker_id: w.worker_id,
            status: format!("{}", w.status),
            cwd: w.cwd,
            events_count: w.events.len(),
            last_error: w.last_error.map(|e| e.message),
            created_at: w.created_at,
            updated_at: w.updated_at,
        }
    }
}

pub async fn create_worker(
    _user: AuthUser,
    Json(payload): Json<CreateWorkerRequest>,
) -> Json<WorkerResponse> {
    let registry = tools::worker_registry();
    let cwd = payload
        .cwd
        .unwrap_or_else(|| std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
    let trusted_roots = payload.trusted_roots.unwrap_or_default();
    let auto_recover = payload.auto_recover_prompt_misdelivery.unwrap_or(true);

    let worker = registry.create(&cwd, &trusted_roots, auto_recover);
    Json(worker.into())
}

pub async fn get_worker(
    _user: AuthUser,
    axum::extract::Path(worker_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let registry = tools::worker_registry();
    let worker = registry
        .get(&worker_id)
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, format!("worker not found: {worker_id}")))?;

    Ok(Json(serde_json::json!({
        "worker_id": worker.worker_id,
        "status": format!("{}", worker.status),
        "cwd": worker.cwd,
        "events_count": worker.events.len(),
        "last_prompt": worker.last_prompt,
        "last_error": worker.last_error.as_ref().map(|e| &e.message),
        "last_event": worker.events.last().map(|e| serde_json::json!({
            "kind": format!("{:?}", e.kind),
            "status": format!("{}", e.status),
            "detail": e.detail,
        })),
        "created_at": worker.created_at,
        "updated_at": worker.updated_at,
    })))
}

#[derive(Deserialize)]
pub struct SendWorkerPromptRequest {
    pub prompt: Option<String>,
}

pub async fn send_worker_prompt(
    _user: AuthUser,
    axum::extract::Path(worker_id): axum::extract::Path<String>,
    Json(payload): Json<SendWorkerPromptRequest>,
) -> Result<Json<WorkerResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::worker_registry();
    let worker = registry
        .send_prompt(&worker_id, payload.prompt.as_deref(), None)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(worker.into()))
}

pub async fn resolve_worker_trust(
    _user: AuthUser,
    axum::extract::Path(worker_id): axum::extract::Path<String>,
) -> Result<Json<WorkerResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::worker_registry();
    let worker = registry
        .resolve_trust(&worker_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(worker.into()))
}

pub async fn restart_worker(
    _user: AuthUser,
    axum::extract::Path(worker_id): axum::extract::Path<String>,
) -> Result<Json<WorkerResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::worker_registry();
    let worker = registry
        .restart(&worker_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(worker.into()))
}

pub async fn terminate_worker(
    _user: AuthUser,
    axum::extract::Path(worker_id): axum::extract::Path<String>,
) -> Result<Json<WorkerResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::worker_registry();
    let worker = registry
        .terminate(&worker_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(worker.into()))
}

// ── Team endpoints ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub task_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct TeamResponse {
    pub team_id: String,
    pub name: String,
    pub status: String,
    pub task_ids: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl From<runtime::team_cron_registry::Team> for TeamResponse {
    fn from(t: runtime::team_cron_registry::Team) -> Self {
        Self {
            team_id: t.team_id,
            name: t.name,
            status: format!("{}", t.status),
            task_ids: t.task_ids,
            created_at: t.created_at,
            updated_at: t.updated_at,
        }
    }
}

pub async fn create_team(
    _user: AuthUser,
    Json(payload): Json<CreateTeamRequest>,
) -> Json<TeamResponse> {
    let registry = tools::team_registry();
    let team = registry.create(&payload.name, payload.task_ids);
    Json(team.into())
}

pub async fn list_teams(
    _user: AuthUser,
) -> Json<Vec<TeamResponse>> {
    let registry = tools::team_registry();
    let teams = registry.list();
    Json(teams.into_iter().map(TeamResponse::from).collect())
}

pub async fn get_team(
    _user: AuthUser,
    axum::extract::Path(team_id): axum::extract::Path<String>,
) -> Result<Json<TeamResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::team_registry();
    let team = registry
        .get(&team_id)
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, format!("team not found: {team_id}")))?;
    Ok(Json(team.into()))
}

pub async fn delete_team(
    _user: AuthUser,
    axum::extract::Path(team_id): axum::extract::Path<String>,
) -> Result<Json<TeamResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::team_registry();
    let team = registry
        .delete(&team_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(team.into()))
}

// ── Cron endpoints ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateCronRequest {
    pub schedule: String,
    pub prompt: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Serialize)]
pub struct CronResponse {
    pub cron_id: String,
    pub schedule: String,
    pub prompt: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub run_count: u64,
    pub last_run_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl From<runtime::team_cron_registry::CronEntry> for CronResponse {
    fn from(e: runtime::team_cron_registry::CronEntry) -> Self {
        Self {
            cron_id: e.cron_id,
            schedule: e.schedule,
            prompt: e.prompt,
            description: e.description,
            enabled: e.enabled,
            run_count: e.run_count,
            last_run_at: e.last_run_at,
            created_at: e.created_at,
            updated_at: e.updated_at,
        }
    }
}

pub async fn create_cron(
    _user: AuthUser,
    Json(payload): Json<CreateCronRequest>,
) -> Result<Json<CronResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::cron_registry();
    let entry = registry.create(&payload.schedule, &payload.prompt, payload.description.as_deref());
    // If caller specified enabled=false, disable after creation
    if payload.enabled == Some(false) {
        let _ = registry.disable(&entry.cron_id);
        let entry = registry.get(&entry.cron_id).unwrap_or(entry);
        return Ok(Json(entry.into()));
    }
    Ok(Json(entry.into()))
}

pub async fn list_crons(
    _user: AuthUser,
) -> Json<Vec<CronResponse>> {
    let registry = tools::cron_registry();
    let entries = registry.list(false);
    Json(entries.into_iter().map(CronResponse::from).collect())
}

pub async fn get_cron(
    _user: AuthUser,
    axum::extract::Path(cron_id): axum::extract::Path<String>,
) -> Result<Json<CronResponse>, (axum::http::StatusCode, String)> {
    let registry = tools::cron_registry();
    let entry = registry
        .get(&cron_id)
        .ok_or_else(|| (axum::http::StatusCode::NOT_FOUND, format!("cron not found: {cron_id}")))?;
    Ok(Json(entry.into()))
}

pub async fn delete_cron(
    _user: AuthUser,
    axum::extract::Path(cron_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let registry = tools::cron_registry();
    let entry = registry
        .delete(&cron_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::json!({"deleted": true, "cron_id": entry.cron_id})))
}

pub async fn disable_cron(
    _user: AuthUser,
    axum::extract::Path(cron_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let registry = tools::cron_registry();
    registry
        .disable(&cron_id)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;
    Ok(Json(serde_json::json!({"disabled": true, "cron_id": cron_id})))
}

// ── Stats endpoint ──────────────────────────────────────────────────────

pub async fn platform_stats(_user: AuthUser) -> Json<serde_json::Value> {
    let tasks = tools::task_registry();
    let teams = tools::team_registry();
    let crons = tools::cron_registry();

    Json(serde_json::json!({
        "tasks": {
            "total": tasks.len(),
        },
        "teams": {
            "total": teams.len(),
        },
        "crons": {
            "total": crons.len(),
        },
    }))
}
