use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspacePath {
    pub relative_path: String,
    pub absolute_path: PathBuf,
}

pub fn workspace_root() -> PathBuf {
    std::env::var("CLAW_WORKSPACE_ROOT")
        .or_else(|_| std::env::var("WORKSPACE_ROOT"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data/workspaces"))
}

pub fn session_workspace(user_id: &str, session_id: &str) -> Result<PathBuf, String> {
    session_workspace_under(&workspace_root(), user_id, session_id)
}

pub fn session_workspace_under(
    root: &Path,
    user_id: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    let user = sanitize_path_component(user_id, "user_id")?;
    let session = sanitize_path_component(session_id, "session_id")?;
    Ok(root.join(user).join(session))
}

pub fn resolve_workspace_path(workspace: &Path, path: &str) -> Result<WorkspacePath, String> {
    let relative_path = sanitize_workspace_path(path)?;
    let absolute_path = workspace.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
    Ok(WorkspacePath {
        relative_path,
        absolute_path,
    })
}

pub fn canonical_workspace_root(workspace: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(workspace)
        .map_err(|error| format!("failed to create session workspace: {error}"))?;
    workspace
        .canonicalize()
        .map_err(|error| format!("failed to resolve session workspace: {error}"))
}

pub fn resolve_existing_workspace_path(
    workspace: &Path,
    path: &str,
) -> Result<WorkspacePath, String> {
    let mut workspace_path = resolve_workspace_path(workspace, path)?;
    let canonical_root = canonical_workspace_root(workspace)?;
    let canonical_target = workspace_path
        .absolute_path
        .canonicalize()
        .map_err(|error| format!("failed to resolve workspace path: {error}"))?;
    ensure_within_workspace(&canonical_root, &canonical_target)?;
    workspace_path.absolute_path = canonical_target;
    Ok(workspace_path)
}

pub fn resolve_workspace_write_path(workspace: &Path, path: &str) -> Result<WorkspacePath, String> {
    let workspace_path = resolve_workspace_path(workspace, path)?;
    let canonical_root = canonical_workspace_root(workspace)?;
    let anchor = nearest_existing_ancestor(&workspace_path.absolute_path)
        .ok_or_else(|| "path must stay inside the session workspace".to_string())?;
    let canonical_anchor = anchor
        .canonicalize()
        .map_err(|error| format!("failed to resolve workspace path ancestor: {error}"))?;
    ensure_within_workspace(&canonical_root, &canonical_anchor)?;

    let safe_absolute_path = if workspace_path.absolute_path.exists() {
        let canonical_target = workspace_path
            .absolute_path
            .canonicalize()
            .map_err(|error| format!("failed to resolve workspace path: {error}"))?;
        ensure_within_workspace(&canonical_root, &canonical_target)?;
        canonical_target
    } else {
        let relative_suffix = workspace_path
            .absolute_path
            .strip_prefix(anchor)
            .map_err(|_| "path must stay inside the session workspace".to_string())?;
        canonical_anchor.join(relative_suffix)
    };

    Ok(WorkspacePath {
        relative_path: workspace_path.relative_path,
        absolute_path: safe_absolute_path,
    })
}

pub fn resolve_workspace_search_path(
    workspace: &Path,
    path: Option<&str>,
) -> Result<PathBuf, String> {
    match path {
        Some(path) => {
            resolve_existing_workspace_path(workspace, path).map(|resolved| resolved.absolute_path)
        }
        None => canonical_workspace_root(workspace),
    }
}

pub fn sanitize_workspace_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path must not be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("path must not contain NUL bytes".to_string());
    }

    let normalized = trimmed.replace('\\', "/");
    let normalized = normalized
        .strip_prefix("/workspace/")
        .or_else(|| normalized.strip_prefix("workspace/"))
        .unwrap_or(&normalized);

    if normalized.starts_with('/') {
        return Err("absolute paths are not allowed in the session workspace".to_string());
    }

    let mut parts = Vec::new();
    for component in Path::new(normalized).components() {
        match component {
            Component::Normal(value) => {
                let part = value
                    .to_str()
                    .ok_or_else(|| "path must be valid UTF-8".to_string())?;
                if part.is_empty() || part == "." || part == ".." || part.contains(':') {
                    return Err(format!("invalid workspace path component: {part}"));
                }
                parts.push(part.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("path must stay inside the session workspace".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("absolute paths are not allowed in the session workspace".to_string());
            }
        }
    }

    if parts.is_empty() {
        return Err("path must name a file inside the session workspace".to_string());
    }

    Ok(parts.join("/"))
}

fn sanitize_path_component(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if trimmed.contains(['/', '\\', ':', '\0']) || trimmed == "." || trimmed == ".." {
        return Err(format!("{label} contains invalid path characters"));
    }
    Ok(trimmed.to_string())
}

fn ensure_within_workspace(workspace_root: &Path, candidate: &Path) -> Result<(), String> {
    if candidate.starts_with(workspace_root) {
        Ok(())
    } else {
        Err("path must stay inside the session workspace".to_string())
    }
}

fn nearest_existing_ancestor(path: &Path) -> Option<&Path> {
    path.ancestors().find(|ancestor| ancestor.exists())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_workspace_root, resolve_existing_workspace_path, resolve_workspace_path,
        resolve_workspace_search_path, resolve_workspace_write_path, sanitize_workspace_path,
        session_workspace_under,
    };
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        std::env::temp_dir().join(format!("claw-api-server-workspace-{name}-{unique}"))
    }

    #[test]
    fn workspace_paths_accept_legacy_workspace_prefix() {
        assert_eq!(
            sanitize_workspace_path("/workspace/nested/file.txt").unwrap(),
            "nested/file.txt"
        );
        assert_eq!(
            sanitize_workspace_path("workspace/nested/file.txt").unwrap(),
            "nested/file.txt"
        );
    }

    #[test]
    fn workspace_paths_reject_escape_attempts() {
        assert!(sanitize_workspace_path("../secret.txt").is_err());
        assert!(sanitize_workspace_path("/etc/passwd").is_err());
        assert!(sanitize_workspace_path("nested/../../secret.txt").is_err());
        assert!(session_workspace_under(Path::new("/tmp/root"), "../user", "session").is_err());
        assert!(session_workspace_under(Path::new("/tmp/root"), "user", "..\\session").is_err());
    }

    #[test]
    fn resolved_workspace_path_stays_under_session_directory() {
        let resolved = resolve_workspace_path(Path::new("/tmp/root/user/session"), "a/b.txt")
            .expect("path should resolve");

        assert_eq!(resolved.relative_path, "a/b.txt");
        assert_eq!(
            resolved.absolute_path,
            Path::new("/tmp/root/user/session").join("a").join("b.txt")
        );
    }

    #[test]
    fn workspace_write_paths_use_canonical_workspace_root() {
        let workspace = temp_path("write-path");
        let resolved = resolve_workspace_write_path(&workspace, "nested/demo.txt")
            .expect("path should resolve");

        let canonical_root = canonical_workspace_root(&workspace).expect("root should resolve");
        assert_eq!(
            resolved.absolute_path,
            canonical_root.join("nested").join("demo.txt")
        );

        std::fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn workspace_search_defaults_to_canonical_workspace_root() {
        let workspace = temp_path("search-root");
        let resolved =
            resolve_workspace_search_path(&workspace, None).expect("root path should resolve");

        assert_eq!(
            resolved,
            canonical_workspace_root(&workspace).expect("root should canonicalize")
        );

        std::fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[test]
    fn existing_workspace_paths_require_files_to_exist() {
        let workspace = temp_path("existing");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        let error = resolve_existing_workspace_path(&workspace, "missing.txt")
            .expect_err("missing file should fail");

        assert!(error.contains("failed to resolve workspace path"));
        std::fs::remove_dir_all(&workspace).expect("cleanup workspace");
    }

    #[cfg(unix)]
    #[test]
    fn workspace_helpers_reject_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let root = temp_path("symlink-root");
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(&outside).expect("create outside directory");

        let safe_file = workspace.join("safe.txt");
        std::fs::write(&safe_file, "safe").expect("write safe file");
        resolve_existing_workspace_path(&workspace, "safe.txt")
            .expect("regular file inside workspace should resolve");

        let escape_link = workspace.join("escape");
        symlink(&outside, &escape_link).expect("create symlink");

        let read_error = resolve_existing_workspace_path(&workspace, "escape")
            .expect_err("symlink outside workspace must be rejected");
        assert!(read_error.contains("inside the session workspace"));

        let write_error = resolve_workspace_write_path(&workspace, "escape/result.txt")
            .expect_err("writes through escaping symlink must be rejected");
        assert!(write_error.contains("inside the session workspace"));

        std::fs::remove_dir_all(&root).expect("cleanup test root");
    }
}
