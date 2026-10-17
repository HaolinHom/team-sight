use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct HolidayDay {
    name: String,
    date: String,
    #[serde(rename = "isOffDay")]
    _is_off_day: bool,
}
#[derive(Deserialize)]
struct HolidayYear {
    year: u16,
    papers: Vec<String>,
    days: Vec<HolidayDay>,
}

fn valid_date(value: &str, year: u16) -> bool {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || value
            .bytes()
            .enumerate()
            .any(|(i, c)| i != 4 && i != 7 && !c.is_ascii_digit())
    {
        return false;
    }
    let parts: Vec<_> = value.split('-').collect();
    let numbers: Option<Vec<u16>> = parts.iter().map(|part| part.parse().ok()).collect();
    let Some(numbers) = numbers else {
        return false;
    };
    if numbers.len() != 3 {
        return false;
    }
    let (y, m, d) = (numbers[0], numbers[1], numbers[2]);
    if !(y == year || y == year - 1) || !(1..=12).contains(&m) {
        return false;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let limit = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][usize::from(m - 1)];
    (1..=limit).contains(&d)
}

fn validate(body: &str, year: u16) -> Result<(), String> {
    let value: HolidayYear =
        serde_json::from_str(body).map_err(|error| format!("节假日数据格式无效：{error}"))?;
    let mut dates = std::collections::HashSet::new();
    if value.year != year
        || value.days.is_empty()
        || value.papers.is_empty()
        || value
            .papers
            .iter()
            .any(|paper| !paper.starts_with("https://") && !paper.starts_with("http://"))
        || value.days.iter().any(|day| {
            day.name.trim().is_empty() || !valid_date(&day.date, year) || !dates.insert(&day.date)
        })
    {
        return Err("节假日数据的年份、日期或公告链接无效".into());
    }
    Ok(())
}

fn fetch_with(
    year: u16,
    mut request: impl FnMut(&str) -> Result<String, String>,
) -> Result<String, String> {
    if !(1000..=9999).contains(&year) {
        return Err("节假日年份无效".into());
    }
    let sources = [
        format!("https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json"),
        format!("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json"),
    ];
    let mut errors = Vec::new();
    for url in sources {
        match request(&url).and_then(|body| {
            validate(&body, year)?;
            Ok(body)
        }) {
            Ok(body) => return Ok(body),
            Err(error) => errors.push(error),
        }
    }
    Err(format!("{year} 年节假日获取失败：{}", errors.join("；")))
}

#[tauri::command]
pub async fn china_calendar_get(year: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_with(year, |url| {
            ureq::get(url)
                .set("Accept", "application/json")
                .set("Cache-Control", "no-cache")
                .timeout(Duration::from_secs(30))
                .call()
                .map_err(|error| error.to_string())?
                .into_string()
                .map_err(|error| format!("读取日历响应失败：{error}"))
        })
    })
    .await
    .map_err(|error| format!("后台日历请求失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn body() -> String {
        r#"{"year":2026,"papers":["https://www.gov.cn/example"],"days":[{"date":"2026-10-10","name":"国庆节","isOffDay":false}]}"#.into()
    }
    #[test]
    fn rejects_invalid_year_without_request() {
        assert!(fetch_with(0, |_| panic!("非法年份不得发请求")).is_err());
    }
    #[test]
    fn uses_only_fixed_sources_and_falls_back_on_bad_payload() {
        let mut urls = Vec::new();
        let result = fetch_with(2026, |url| {
            urls.push(url.to_string());
            if urls.len() == 1 {
                Ok("{}".into())
            } else {
                Ok(body())
            }
        });
        assert_eq!(result.unwrap(), body());
        assert_eq!(
            urls,
            vec![
                "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json",
                "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json"
            ]
        );
    }
    #[test]
    fn validates_dates_and_previous_december() {
        assert!(valid_date("2025-12-31", 2026));
        assert!(!valid_date("2026-02-29", 2026));
        assert!(valid_date("2024-02-29", 2025));
        assert!(!valid_date("2024-02-29", 2026));
        assert!(!valid_date("2026-1+-01", 2026));
        assert!(validate(&body().replace("2026-10-10", "2026-02-30"), 2026).is_err());
    }
    #[test]
    fn reports_both_network_failures() {
        assert!(fetch_with(2026, |_| Err("offline".into()))
            .unwrap_err()
            .contains("offline；offline"));
    }
}
