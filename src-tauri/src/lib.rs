//! Tauri 侧能力：本地凭据/配置存储 + TAPD 只读请求代理。
//!
//! 阶段1 说明：凭据（TAPD personal token）保存在应用配置目录下的 `credentials.json`，
//! 文件权限 0600，不进版本控制。这是一个已知的临时取舍——技术方案 §4.3 要求最终使用
//! 操作系统凭据存储；届时只需替换本文件内的读写实现与 `source` 取值，前端契约不变。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const TAPD_API_BASE: &str = "https://api.tapd.cn";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CREDENTIAL_FILE: &str = "credentials.json";
const SETTINGS_FILE: &str = "settings.json";

/// 凭据来源，用于让界面区分「应用内保存」与「开发期环境变量」。
const SOURCE_FILE: &str = "file";
const SOURCE_ENV: &str = "env";
const SOURCE_NONE: &str = "none";

#[derive(Serialize, Deserialize)]
struct CredentialFile {
    token: String,
}

#[derive(Serialize)]
struct CredentialStatus {
    configured: bool,
    source: &'static str,
    masked_hint: Option<String>,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("无法定位应用配置目录：{error}"))
}

/// 掩码只暴露首尾各 4 位，避免整串令牌进入前端或日志。
fn mask_token(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() <= 8 {
        return "…".to_string();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("设置文件权限失败：{error}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// 先写临时文件再重命名，避免写入中断留下半截配置。
fn write_atomic(path: &Path, content: &str, private: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
    }
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content).map_err(|error| format!("写入临时文件失败：{error}"))?;
    if private {
        restrict_permissions(&temp_path)?;
    }
    fs::rename(&temp_path, path).map_err(|error| format!("替换配置文件失败：{error}"))?;
    Ok(())
}

fn read_token_from_file(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(CREDENTIAL_FILE);
    let Ok(content) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let parsed: CredentialFile =
        serde_json::from_str(&content).map_err(|error| format!("凭据文件格式异常：{error}"))?;
    let token = parsed.token.trim().to_string();
    Ok((!token.is_empty()).then_some(token))
}

fn write_token_to_file(dir: &Path, token: &str) -> Result<(), String> {
    let payload = serde_json::to_string(&CredentialFile {
        token: token.to_string(),
    })
    .map_err(|error| format!("序列化凭据失败：{error}"))?;
    write_atomic(&dir.join(CREDENTIAL_FILE), &payload, true)
}

fn read_settings_from(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(SETTINGS_FILE);
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取配置失败：{error}")),
    }
}

fn write_settings_to(dir: &Path, settings_json: &str) -> Result<(), String> {
    // 只校验是合法 JSON，具体结构由前端负责，避免 Rust 与前端 schema 双份维护。
    serde_json::from_str::<serde_json::Value>(settings_json)
        .map_err(|error| format!("配置不是合法 JSON：{error}"))?;
    write_atomic(&dir.join(SETTINGS_FILE), settings_json, false)
}

/// 开发期回退：环境变量 `TAPD_PERSONAL_TOKEN`，其次仓库根的 `.env.local`（仅 debug 构建）。
fn token_from_env() -> Option<String> {
    if let Ok(token) = std::env::var("TAPD_PERSONAL_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if !cfg!(debug_assertions) {
        return None;
    }

    for candidate in ["../.env.local", ".env.local"] {
        let Ok(content) = fs::read_to_string(candidate) else {
            continue;
        };
        for line in content.lines() {
            let Some(value) = line.strip_prefix("PERSONAL_TOKEN=") else {
                continue;
            };
            let token = value.trim().trim_matches('"').trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

/// 令牌解析顺序：应用内保存的文件 → 环境变量/.env.local。
fn resolve_token(dir: &Path) -> Result<(String, &'static str), String> {
    if let Some(token) = read_token_from_file(dir)? {
        return Ok((token, SOURCE_FILE));
    }
    if let Some(token) = token_from_env() {
        return Ok((token, SOURCE_ENV));
    }
    Err("尚未配置 TAPD 令牌，请在设置页保存令牌".to_string())
}

/// 只读 GET 请求。令牌只在此函数内使用，不会返回给前端。
fn tapd_request(token: &str, path: &str, params: &[(String, String)]) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err(format!("非法 path：{path}（必须以 / 开头）"));
    }

    // 诊断日志：只记录接口路径，不记录参数值与凭据。
    eprintln!("[tapd_get] GET {path}");

    let url = format!("{TAPD_API_BASE}{path}");
    let mut request = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json")
        .timeout(REQUEST_TIMEOUT);

    for (key, value) in params {
        request = request.query(key, value);
    }

    match request.call() {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("读取 TAPD 响应失败：{error}")),
        // TAPD 会用 4xx 返回结构化错误体，这里把响应体交回前端统一处理。
        Err(ureq::Error::Status(_status, response)) => response
            .into_string()
            .map_err(|error| format!("读取 TAPD 错误响应失败：{error}")),
        Err(error) => Err(format!("请求 TAPD 失败：{error}")),
    }
}

#[tauri::command]
fn tapd_get(
    app: tauri::AppHandle,
    path: String,
    params: Vec<(String, String)>,
) -> Result<String, String> {
    let (token, _source) = resolve_token(&config_dir(&app)?)?;
    tapd_request(&token, &path, &params)
}

#[tauri::command]
fn credential_set(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("令牌不能为空".to_string());
    }
    write_token_to_file(&config_dir(&app)?, trimmed)
}

#[tauri::command]
fn credential_status(app: tauri::AppHandle) -> Result<CredentialStatus, String> {
    let dir = config_dir(&app)?;
    if let Some(token) = read_token_from_file(&dir)? {
        return Ok(CredentialStatus {
            configured: true,
            source: SOURCE_FILE,
            masked_hint: Some(mask_token(&token)),
        });
    }
    if let Some(token) = token_from_env() {
        return Ok(CredentialStatus {
            configured: true,
            source: SOURCE_ENV,
            masked_hint: Some(mask_token(&token)),
        });
    }
    Ok(CredentialStatus {
        configured: false,
        source: SOURCE_NONE,
        masked_hint: None,
    })
}

#[tauri::command]
fn credential_delete(app: tauri::AppHandle) -> Result<(), String> {
    let path = config_dir(&app)?.join(CREDENTIAL_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除凭据失败：{error}")),
    }
}

#[tauri::command]
fn settings_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    read_settings_from(&config_dir(&app)?)
}

#[tauri::command]
fn settings_write(app: tauri::AppHandle, settings_json: String) -> Result<(), String> {
    write_settings_to(&config_dir(&app)?, &settings_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            tapd_get,
            credential_set,
            credential_status,
            credential_delete,
            settings_read,
            settings_write
        ])
        .run(tauri::generate_context!())
        .expect("TeamSight 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "team-sight-test-{label}-{}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).expect("创建临时目录失败");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn env_value(key: &str) -> Option<String> {
        let content = fs::read_to_string("../.env.local").ok()?;
        content.lines().find_map(|line| {
            let value = line.strip_prefix(&format!("{key}="))?;
            let trimmed = value.trim().trim_matches('"').trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
    }

    fn parse_envelope(body: &str) -> serde_json::Value {
        serde_json::from_str(body).expect("TAPD 响应不是合法 JSON")
    }

    #[test]
    fn mask_token_keeps_only_edges() {
        assert_eq!(mask_token("0123456789abcdef"), "0123…cdef");
        assert_eq!(mask_token("short"), "…");
    }

    #[test]
    fn credential_file_round_trip_and_permissions() {
        let dir = TempDir::new("credential");
        assert_eq!(read_token_from_file(dir.path()).unwrap(), None);

        write_token_to_file(dir.path(), "token-value-123456").unwrap();
        assert_eq!(
            read_token_from_file(dir.path()).unwrap(),
            Some("token-value-123456".to_string())
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join(CREDENTIAL_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "凭据文件权限必须是 0600");
        }
    }

    #[test]
    fn settings_file_round_trip_and_atomic_replace() {
        let dir = TempDir::new("settings");
        assert_eq!(read_settings_from(dir.path()).unwrap(), None);

        write_settings_to(dir.path(), r#"{"schemaVersion":1}"#).unwrap();
        assert_eq!(
            read_settings_from(dir.path()).unwrap(),
            Some(r#"{"schemaVersion":1}"#.to_string())
        );

        write_settings_to(dir.path(), r#"{"schemaVersion":1,"projects":[]}"#).unwrap();
        assert!(read_settings_from(dir.path())
            .unwrap()
            .expect("配置应存在")
            .contains("projects"));
        assert!(!dir.path().join("settings.json.tmp").exists());

        assert!(write_settings_to(dir.path(), "not-json").is_err());
    }

    #[test]
    fn corrupted_credential_file_reports_error() {
        let dir = TempDir::new("corrupt");
        fs::write(dir.path().join(CREDENTIAL_FILE), "{oops").unwrap();
        assert!(read_token_from_file(dir.path()).is_err());
    }

    /// 需要真实凭据的手工验证：`cd src-tauri && cargo test -- --ignored`。
    /// 断言只读取 status/info，避免把响应体中的凭据写进日志。
    #[test]
    #[ignore = "需要 .env.local 中的 PERSONAL_TOKEN"]
    fn tapd_request_authenticates_with_bearer_token() {
        let token = token_from_env().expect("未找到 TAPD 令牌");
        let body = tapd_request(&token, "/quickstart/testauth", &[]).expect("请求 TAPD 失败");
        let envelope = parse_envelope(&body);
        assert_eq!(
            envelope["status"].as_i64().unwrap_or(0),
            1,
            "认证失败，info={}",
            envelope["info"]
        );
    }

    /// 需要真实凭据与项目 ID 的手工验证，覆盖项目枚举与业务数据拉取。
    #[test]
    #[ignore = "需要 .env.local 中的 PERSONAL_TOKEN 与 WORKSPACE_IDS"]
    fn tapd_request_returns_projects_and_tasks() {
        let token = token_from_env().expect("未找到 TAPD 令牌");

        let projects = parse_envelope(
            &tapd_request(&token, "/workspaces/user_participant_projects", &[])
                .expect("请求项目列表失败"),
        );
        assert_eq!(projects["status"].as_i64().unwrap_or(0), 1);
        assert!(
            !projects["data"]
                .as_array()
                .expect("data 不是数组")
                .is_empty(),
            "未返回任何项目"
        );

        let workspace_id = env_value("WORKSPACE_IDS")
            .and_then(|value| value.split(',').next().map(|item| item.trim().to_string()))
            .expect("未在 .env.local 中配置 WORKSPACE_IDS");

        let tasks = parse_envelope(
            &tapd_request(
                &token,
                "/tasks",
                &[
                    ("workspace_id".to_string(), workspace_id),
                    ("limit".to_string(), "2".to_string()),
                    (
                        "fields".to_string(),
                        "id,name,begin,due,owner,status".to_string(),
                    ),
                ],
            )
            .expect("请求 TAPD 任务接口失败"),
        );
        assert_eq!(tasks["status"].as_i64().unwrap_or(0), 1);
        let rows = tasks["data"].as_array().expect("data 不是数组");
        assert!(!rows.is_empty(), "时间范围内未返回任务");
        assert!(rows[0]["Task"]["id"].is_string(), "缺少任务 ID 字段");
    }
}
