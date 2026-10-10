//! Tauri 侧能力：代为访问 TAPD Open API，令牌只保留在 Rust 进程内。
//!
//! 阶段0 说明：命令仅用于验证「桌面端发起 HTTPS 请求」这条链路，
//! 凭据来源为环境变量 `TAPD_PERSONAL_TOKEN` 或仓库根目录 `.env.local`（开发期）。
//! 正式版本（阶段1）改为操作系统凭据存储（Keychain）。

use std::fs;
use std::time::Duration;

const TAPD_API_BASE: &str = "https://api.tapd.cn";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// 解析 TAPD 凭据：环境变量优先，其次读取开发期 `.env.local`。
fn read_personal_token() -> Result<String, String> {
    if let Ok(token) = std::env::var("TAPD_PERSONAL_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
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
                return Ok(token.to_string());
            }
        }
    }

    Err("未找到 TAPD 凭据：请设置环境变量 TAPD_PERSONAL_TOKEN，或在仓库根目录 .env.local 中写入 PERSONAL_TOKEN".to_string())
}

/// 只读 GET 代理。`path` 必须以 `/` 开头，令牌不会返回给前端。
#[tauri::command]
fn tapd_get(path: String, params: Vec<(String, String)>) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err(format!("非法 path：{path}（必须以 / 开头）"));
    }

    // 诊断日志：只记录接口路径，不记录参数值与凭据。
    eprintln!("[tapd_get] GET {path}");

    let token = read_personal_token()?;
    let url = format!("{TAPD_API_BASE}{path}");

    let mut request = ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/json")
        .timeout(REQUEST_TIMEOUT);

    for (key, value) in params {
        request = request.query(&key, &value);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![tapd_get])
        .run(tauri::generate_context!())
        .expect("TeamSight 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 从 `.env.local` 读取指定键（仅测试使用，不打印密钥）。
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

    /// 需要真实凭据的手工验证：`cd src-tauri && cargo test -- --ignored`。
    /// 断言只读取 status/info，避免把响应体中的凭据写进日志。
    #[test]
    #[ignore = "需要 .env.local 中的 PERSONAL_TOKEN"]
    fn tapd_get_authenticates_with_bearer_token() {
        let body = tapd_get("/quickstart/testauth".to_string(), vec![]).expect("请求 TAPD 失败");
        let envelope = parse_envelope(&body);
        assert_eq!(
            envelope["status"].as_i64().unwrap_or(0),
            1,
            "认证失败，info={}",
            envelope["info"]
        );
    }

    /// 需要真实凭据与项目 ID 的手工验证，覆盖「Rust 侧发起 HTTPS 请求并取得业务数据」。
    #[test]
    #[ignore = "需要 .env.local 中的 PERSONAL_TOKEN 与 WORKSPACE_IDS"]
    fn tapd_get_returns_tasks_for_configured_workspace() {
        let workspace_id = env_value("WORKSPACE_IDS")
            .and_then(|value| value.split(',').next().map(|item| item.trim().to_string()))
            .expect("未在 .env.local 中配置 WORKSPACE_IDS");

        let body = tapd_get(
            "/tasks".to_string(),
            vec![
                ("workspace_id".to_string(), workspace_id),
                ("limit".to_string(), "2".to_string()),
                ("fields".to_string(), "id,name,begin,due,owner,status".to_string()),
            ],
        )
        .expect("请求 TAPD 任务接口失败");

        let envelope = parse_envelope(&body);
        assert_eq!(
            envelope["status"].as_i64().unwrap_or(0),
            1,
            "任务接口返回异常，info={}",
            envelope["info"]
        );
        let rows = envelope["data"].as_array().expect("data 不是数组");
        assert!(!rows.is_empty(), "时间范围内未返回任务");
        assert!(rows[0]["Task"]["id"].is_string(), "缺少任务 ID 字段");
    }
}
