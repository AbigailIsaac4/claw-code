use axum::response::Json;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Serialize, Clone)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
}

static CACHED_SKILLS: OnceLock<Vec<SkillInfo>> = OnceLock::new();

/// Returns cached skills list (discovered once on first call).
pub fn cached_skills() -> &'static [SkillInfo] {
    CACHED_SKILLS.get_or_init(|| {
        discover_skills().unwrap_or_else(|e| {
            tracing::warn!("Failed to discover skills: {e}");
            vec![]
        })
    })
}

/// Build a system prompt snippet listing available skills for the LLM.
pub fn build_skills_system_prompt() -> Option<String> {
    let skills = cached_skills();
    if skills.is_empty() {
        return None;
    }
    let mut lines = vec![
        "The following skills are available. Use the Skill tool to load one when relevant to the task.".to_string(),
        String::new(),
    ];
    for skill in skills {
        lines.push(format!("- **{}**: {}", skill.name, skill.description));
    }
    Some(lines.join("\n"))
}

pub async fn list_skills() -> Json<Value> {
    let mut skills_list: Vec<SkillInfo> = cached_skills().to_vec();
    skills_list.sort_by(|a, b| a.name.cmp(&b.name));
    Json(json!({
        "status": "success",
        "data": skills_list
    }))
}

fn discover_skills() -> Result<Vec<SkillInfo>, std::io::Error> {
    let mut skills_list = Vec::new();

    // Check CLAW_SKILLS_ROOT first (set by api-server startup for web mode)
    let skills_dir = if let Ok(root) = std::env::var("CLAW_SKILLS_ROOT") {
        PathBuf::from(root)
    } else {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut dir = cwd.join("assets").join("skills");
        if !dir.exists() {
            dir = cwd
                .parent()
                .unwrap_or(&cwd)
                .join("assets")
                .join("skills");
        }
        dir
    };

    if !skills_dir.exists() {
        return Ok(skills_list);
    }

    let entries = fs::read_dir(&skills_dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.is_file() {
                if let Ok(content) = fs::read_to_string(&skill_file) {
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let mut desc = "No description available.".to_string();
                    for line in content.lines() {
                        if line.starts_with("description: ") {
                            desc = line
                                .trim_start_matches("description: ")
                                .trim()
                                .to_string();
                            break;
                        }
                    }
                    skills_list.push(SkillInfo {
                        name,
                        description: desc,
                        path: skill_file.display().to_string().replace('\\', "/"),
                    });
                }
            }
        }
    }

    Ok(skills_list)
}
