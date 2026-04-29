use axum::response::Json;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
}

pub async fn list_skills() -> Json<Value> {
    let mut skills_list = Vec::new();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    
    // Try current dir first, then parent (if running from within /rust)
    let mut skills_dir = cwd.join("assets").join("skills");
    if !skills_dir.exists() {
        skills_dir = cwd.parent().unwrap_or(&cwd).join("assets").join("skills");
    }

    if let Ok(entries) = fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let skill_file = path.join("SKILL.md");
                if skill_file.is_file() {
                    if let Ok(content) = fs::read_to_string(&skill_file) {
                        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let mut desc = "No description available.".to_string();
                        for line in content.lines() {
                            if line.starts_with("description: ") {
                                desc = line.trim_start_matches("description: ").trim().to_string();
                                break;
                            }
                        }
                        skills_list.push(SkillInfo {
                            name,
                            description: desc,
                            path: skill_file.display().to_string().replace("\\", "/"),
                        });
                    }
                }
            }
        }
    }

    // Sort skills alphabetically by name
    skills_list.sort_by(|a, b| a.name.cmp(&b.name));

    Json(json!({
        "status": "success",
        "data": skills_list
    }))
}
