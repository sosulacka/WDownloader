use super::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    tool: String,
    stage: String,
    downloaded: u64,
    total: Option<u64>,
    progress: Option<f64>,
}

#[derive(Serialize)]
pub(super) struct InstallFailure {
    tool: String,
    message: String,
    folder: String,
}

fn progress(app: &tauri::AppHandle, tool: &str, stage: &str, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            tool: tool.into(),
            stage: stage.into(),
            downloaded,
            total,
            progress: total
                .filter(|t| *t > 0)
                .map(|t| (downloaded as f64 / t as f64 * 100.0).min(100.0)),
        },
    );
}

async fn download(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    tool: &str,
    url: &str,
    destination: &Path,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Не удалось подключиться к серверу загрузки: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Сервер не отдал файл: {e}"))?;
    let total = response.content_length();
    let mut file = std::fs::File::create(destination)
        .map_err(|e| format!("Не удалось создать временный файл: {e}"))?;
    let mut downloaded = 0u64;
    let mut last_update = 0u64;
    progress(app, tool, "downloading", 0, total);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Загрузка прервалась: {e}"))?
    {
        downloaded += chunk.len() as u64;
        if downloaded > 700 * 1024 * 1024 {
            return Err("Размер архива превысил ожидаемый предел.".into());
        }
        file.write_all(&chunk)
            .map_err(|e| format!("Не удалось записать файл: {e}"))?;
        if downloaded.saturating_sub(last_update) >= 512 * 1024 {
            last_update = downloaded;
            progress(app, tool, "downloading", downloaded, total);
        }
    }
    if downloaded == 0 || total.is_some_and(|t| t != downloaded) {
        return Err("Файл загрузился не полностью. Повторите установку.".into());
    }
    file.sync_all().map_err(|e| e.to_string())?;
    progress(app, tool, "downloaded", downloaded, total);
    Ok(())
}

fn unpack(archive: &Path, directory: &Path, binaries: &[&str]) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Не удалось открыть ZIP: {e}"))?;
    let mut found = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let filename = entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        if let Some(name) = filename.filter(|name| binaries.contains(&name.as_str())) {
            if entry.size() > 500 * 1024 * 1024 {
                return Err("Неожиданный размер исполняемого файла.".into());
            }
            let mut output =
                std::fs::File::create(directory.join(&name)).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|e| format!("Не удалось распаковать {name}: {e}"))?;
            found.push(name);
        }
    }
    if binaries.iter().any(|name| !found.iter().any(|n| n == name)) {
        return Err("В архиве не оказалось нужных компонентов.".into());
    }
    Ok(())
}

async fn verify_binary(path: &Path, name: &str) -> Result<(), String> {
    let argument = if name.starts_with("ff") {
        "-version"
    } else {
        "--version"
    };
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        command(path).arg(argument).output(),
    )
    .await
    .map_err(|_| format!("{name} не ответил после установки."))?
    .map_err(|e| format!("Не удалось запустить {name}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{name} не прошёл проверку запуска."));
    }
    Ok(())
}

pub(super) async fn install_one(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    tool: &str,
    target: &Path,
    ytdlp_tag: Option<&str>,
) -> Result<(), String> {
    let staging = target.join(format!(".install-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let binaries = match tool {
        "yt-dlp" => vec!["yt-dlp.exe"],
        "FFmpeg" => vec!["ffmpeg.exe", "ffprobe.exe"],
        _ => vec!["deno.exe"],
    };
    let result = async {
        if tool == "yt-dlp" {
            let file = staging.join("yt-dlp.exe");
            let base = match ytdlp_tag {
                Some(tag) => format!("https://github.com/yt-dlp/yt-dlp/releases/download/{tag}"),
                None => "https://github.com/yt-dlp/yt-dlp/releases/latest/download".into(),
            };
            download(app, client, tool, &format!("{base}/yt-dlp.exe"), &file).await?;
            let sums = client.get(format!("{base}/SHA2-256SUMS")).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
            let expected = sums.lines().find_map(|line| { let mut parts = line.split_whitespace(); let hash = parts.next()?; if parts.next()? == "yt-dlp.exe" { Some(hash) } else { None } }).ok_or("Не удалось получить контрольную сумму yt-dlp.")?;
            let mut reader = std::fs::File::open(&file).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop { let count = reader.read(&mut buffer).map_err(|e| e.to_string())?; if count == 0 { break; } hash.update(&buffer[..count]); }
            if format!("{:x}", hash.finalize()) != expected { return Err("Контрольная сумма yt-dlp не совпала. Повторите загрузку.".into()); }
        } else {
            let url = if tool == "FFmpeg" { "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip" } else { "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" };
            let archive = staging.join("download.zip");
            download(app, client, tool, url, &archive).await?;
            progress(app, tool, "extracting", 0, None);
            let source = archive.clone(); let destination = staging.clone(); let names = binaries.clone();
            tauri::async_runtime::spawn_blocking(move || unpack(&source, &destination, &names)).await.map_err(|e| e.to_string())??;
            std::fs::remove_file(archive).map_err(|e| e.to_string())?;
        }
        progress(app, tool, "verifying", 0, None);
        for binary in &binaries { verify_binary(&staging.join(binary), binary).await?; }
        for binary in &binaries {
            let destination = target.join(binary);
            // Заменяем целиком: при сбое старый файл остаётся на месте.
            std::fs::rename(staging.join(binary), destination).map_err(|e| format!("Не удалось сохранить {binary}: {e}"))?;
        }
        progress(app, tool, "ready", 0, None);
        Ok(())
    }.await;
    // Удаляем только файлы из своей временной папки.
    if let Ok(entries) = std::fs::read_dir(&staging) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let _ = std::fs::remove_dir(staging);
    result
}

#[tauri::command]
pub(super) async fn ensure_dependencies(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
) -> Result<Dependencies, InstallFailure> {
    let target = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
        .join("tools");
    let failure = |tool: &str, message: String| InstallFailure {
        tool: tool.into(),
        message,
        folder: target.to_string_lossy().into_owned(),
    };
    let _permit = state
        .install_slot
        .acquire()
        .await
        .map_err(|e| failure("Компоненты", e.to_string()))?;
    let needed = [
        ("yt-dlp", locate(&app, "yt-dlp").is_none()),
        (
            "FFmpeg",
            locate(&app, "ffmpeg").is_none() || locate(&app, "ffprobe").is_none(),
        ),
        ("Deno", locate(&app, "deno").is_none()),
    ];
    if !needed.iter().any(|(_, missing)| *missing) {
        return Ok(check_dependencies(app));
    }
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err(failure("Компоненты", "Автоустановка пока доступна для Windows x64. Установите yt-dlp, FFmpeg и Deno через менеджер пакетов и добавьте их в PATH.".into()));
    }
    std::fs::create_dir_all(&target).map_err(|e| {
        failure(
            "Компоненты",
            format!("Нет доступа к папке компонентов: {e}"),
        )
    })?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("Wdownloader/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(25))
        .read_timeout(std::time::Duration::from_secs(45))
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| failure("Сеть", e.to_string()))?;
    for (tool, missing) in needed {
        if missing {
            install_one(&app, &client, tool, &target, None)
                .await
                .map_err(|e| failure(tool, e))?;
        }
    }
    Ok(check_dependencies(app))
}

#[tauri::command]
pub(super) fn open_tool_download(tool: String) -> Result<(), String> {
    let url = match tool.as_str() {
        "yt-dlp" => "https://github.com/yt-dlp/yt-dlp/releases/latest",
        "FFmpeg" => "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest",
        "Deno" => "https://github.com/denoland/deno/releases/latest",
        _ => return Err("Неизвестный компонент".into()),
    };
    #[cfg(windows)]
    let mut cmd = command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = command("xdg-open");
    cmd.kill_on_drop(false)
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Сайт команды из пасхалки. Адрес фиксирован, фронт не передаёт URL.
#[tauri::command]
pub(super) fn open_team_site() -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = command("xdg-open");
    cmd.kill_on_drop(false)
        .arg("https://wteam.su")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_archive_can_be_retried_in_same_folder() {
        let folder =
            std::env::temp_dir().join(format!("wd-installer-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&folder).unwrap();
        let archive = folder.join("download.zip");
        std::fs::write(&archive, b"incomplete download").unwrap();
        assert!(unpack(&archive, &folder, &["deno.exe"]).is_err());

        let file = std::fs::File::create(&archive).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("bin/deno.exe", options).unwrap();
        zip.write_all(b"test binary").unwrap();
        zip.start_file("../../outside.exe", options).unwrap();
        zip.write_all(b"unexpected file").unwrap();
        zip.finish().unwrap();
        unpack(&archive, &folder, &["deno.exe"]).unwrap();
        assert_eq!(
            std::fs::read(folder.join("deno.exe")).unwrap(),
            b"test binary"
        );
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);
        assert!(unpack(&archive, &folder, &["ffmpeg.exe", "ffprobe.exe"]).is_err());
        std::fs::remove_file(archive).unwrap();
        std::fs::remove_file(folder.join("deno.exe")).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }

    #[tokio::test]
    async fn missing_binary_returns_a_readable_error() {
        let missing = std::env::temp_dir().join(format!("wd-missing-{}.exe", uuid::Uuid::new_v4()));
        let error = verify_binary(&missing, "deno.exe").await.unwrap_err();
        assert!(error.contains("Не удалось запустить deno.exe"));
    }

    #[test]
    fn unknown_manual_download_is_rejected() {
        assert!(open_tool_download("https://example.org".into()).is_err());
    }
}
