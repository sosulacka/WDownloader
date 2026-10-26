//! Вход в YouTube прямо в приложении. Окно WebView2 открывает страницу входа Google,
//! после входа cookies YouTube сохраняются как сессия для yt-dlp.
//! Браузерные cookies Chrome читать нельзя (шифрование App-Bound), поэтому вход свой.

use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "youtube-login";
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
/// Эти cookies появляются только после входа в аккаунт.
const SIGNED_IN: [&str; 3] = ["SAPISID", "__Secure-3PAPISID", "LOGIN_INFO"];

fn netscape(cookies: &[tauri::webview::cookie::Cookie<'static>]) -> String {
    let fallback = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + 30 * 24 * 3600)
        .unwrap_or(0);
    let mut out = String::from("# Netscape HTTP Cookie File\r\n");
    for cookie in cookies {
        let domain = cookie.domain().unwrap_or("youtube.com").trim_start_matches('.');
        if domain != "youtube.com" && !domain.ends_with(".youtube.com") {
            continue;
        }
        let expires = cookie
            .expires_datetime()
            .map(|d| d.unix_timestamp().max(0) as u64)
            .unwrap_or(fallback);
        let prefix = if cookie.http_only() == Some(true) { "#HttpOnly_" } else { "" };
        out.push_str(&format!(
            "{prefix}.{domain}\tTRUE\t{}\t{}\t{expires}\t{}\t{}\r\n",
            cookie.path().unwrap_or("/"),
            if cookie.secure() == Some(true) { "TRUE" } else { "FALSE" },
            cookie.name(),
            cookie.value(),
        ));
    }
    out
}

/// Открывает окно входа и ждёт, пока пользователь войдёт или закроет окно.
/// Возвращает true, если сессия сохранена.
#[tauri::command]
pub(super) async fn youtube_login(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_focus();
        return Ok(false);
    }
    let url = LOGIN_URL.parse().map_err(|_| "Некорректный адрес входа.".to_string())?;
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
        .title("Вход в YouTube")
        .inner_size(480.0, 720.0)
        .center()
        .build()
        .map_err(|e| format!("Не удалось открыть окно входа: {e}"))?;

    let youtube: url::Url = "https://www.youtube.com/".parse().unwrap();
    for _ in 0..600 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let Some(window) = app.get_webview_window(LABEL) else {
            return Ok(false);
        };
        // На Windows чтение cookies блокирует поток, поэтому отдельный поток.
        let target = youtube.clone();
        let cookies = tauri::async_runtime::spawn_blocking(move || window.cookies_for_url(target))
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
        if cookies.iter().any(|c| SIGNED_IN.contains(&c.name())) {
            // Даём YouTube дописать остальные cookies после редиректа.
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(window) = app.get_webview_window(LABEL) else {
                return Ok(false);
            };
            let target = youtube.clone();
            let handle = window.clone();
            let cookies = tauri::async_runtime::spawn_blocking(move || handle.cookies_for_url(target))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| format!("Не удалось прочитать сессию: {e}"))?;
            super::youtube_session::store(&app, &netscape(&cookies))?;
            let _ = window.close();
            return Ok(true);
        }
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.close();
    }
    Err("Вход не завершён за 10 минут. Попробуйте ещё раз.".into())
}

/// Открывает ролик в браузере по умолчанию. Ссылка проверяется так же, как при поиске.
#[tauri::command]
pub(super) fn open_in_browser(url: String) -> Result<(), String> {
    let url = super::normalize_url(&url)?;
    super::command("explorer.exe")
        .kill_on_drop(false)
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Не удалось открыть браузер.".to_string())
}
