use super::*;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastCheck {
    checked_at: u64,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateResult {
    status: &'static str,
    version: Option<String>,
}

fn version_numbers(version: &str) -> Option<Vec<u32>> {
    if version.len() > 32 {
        return None;
    }
    let parts = version
        .split('.')
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.len() < 3 {
        return None;
    }
    Some(parts)
}

async fn current_version(app: &tauri::AppHandle) -> Option<String> {
    let path = locate(app, "yt-dlp")?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        command(path).arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8(output.stdout).ok()?.trim().to_string();
    version_numbers(&version)?;
    Some(version)
}

#[tauri::command]
pub(super) async fn update_ytdlp(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
    force: bool,
) -> Result<UpdateResult, String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Ok(UpdateResult {
            status: "unsupported",
            version: None,
        });
    }
    let _permit = state
        .install_slot
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    if !state.controls.lock().unwrap().is_empty() {
        return Ok(UpdateResult {
            status: "deferred",
            version: None,
        });
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Не удалось открыть папку компонентов.".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|_| "Не удалось открыть папку компонентов.".to_string())?;
    let marker = dir.join("yt-dlp-update.json");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if !force {
        let last = std::fs::read(&marker)
            .ok()
            .and_then(|data| serde_json::from_slice::<LastCheck>(&data).ok());
        if let Some(last) =
            last.filter(|last| last.checked_at <= now && now - last.checked_at < 86400)
        {
            if let Some(error) = last.error {
                return Err(error);
            }
            return Ok(UpdateResult {
                status: "recent",
                version: last.version,
            });
        }
    }
    let version = current_version(&app).await;
    let result = async {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Wdownloader/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(15))
            .read_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?;
        let response = client
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .send()
            .await
            .map_err(|_| {
                "GitHub недоступен. Проверьте подключение и повторите обновление.".to_string()
            })?
            .error_for_status()
            .map_err(|_| {
                "GitHub не отдал сведения о версии. Повторите обновление позже.".to_string()
            })?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let release: Value = serde_json::from_str(&response)
            .map_err(|_| "Не удалось прочитать версию yt-dlp.".to_string())?;
        let tag = release["tag_name"]
            .as_str()
            .ok_or("Не удалось прочитать версию yt-dlp.")?;
        let remote = version_numbers(tag).ok_or("Не удалось прочитать версию yt-dlp.")?;
        if version
            .as_deref()
            .and_then(version_numbers)
            .is_some_and(|installed| installed >= remote)
        {
            return Ok(UpdateResult {
                status: "current",
                version: version.clone(),
            });
        }
        let target = dir.join("tools");
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        installer::install_one(&app, &client, "yt-dlp", &target, Some(tag)).await?;
        Ok(UpdateResult {
            status: "updated",
            version: Some(tag.to_string()),
        })
    }
    .await;
    let last = LastCheck {
        checked_at: now,
        version: result
            .as_ref()
            .ok()
            .and_then(|result| result.version.clone())
            .or(version),
        error: result.as_ref().err().cloned(),
    };
    if let Ok(data) = serde_json::to_vec(&last) {
        let _ = std::fs::write(marker, data);
    }
    result
}
