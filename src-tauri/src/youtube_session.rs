use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};
use tauri::Manager;

const INVALID_FILE: &str = "Нужен файл cookies.txt в формате Netscape с cookies YouTube.";
const STORAGE_ERROR: &str = "Не удалось сохранить сессию YouTube в папке приложения.";
const MAX_SIZE: u64 = 5 * 1024 * 1024;

fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("auth"))
        .map_err(|_| STORAGE_ERROR.into())
}

pub(super) struct SessionFile {
    pub path: PathBuf,
}

impl Drop for SessionFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn write_private(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| STORAGE_ERROR.to_string())?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|_| STORAGE_ERROR.into())
}

// У каждого процесса своя копия: yt-dlp может обновлять cookie-файл.
pub(super) fn prepare(app: &tauri::AppHandle) -> Result<Option<SessionFile>, String> {
    let dir = folder(app)?;
    let data = match fs::read(dir.join("youtube-cookies.txt")) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(
                "Не удалось прочитать сессию YouTube. Импортируйте её заново в настройках.".into(),
            )
        }
    };
    let session = SessionFile {
        path: dir.join(format!("request-{}.cookies.txt", uuid::Uuid::new_v4())),
    };
    write_private(&session.path, &data)?;
    Ok(Some(session))
}

#[tauri::command]
pub(super) fn youtube_session_connected(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(folder(&app)?.join("youtube-cookies.txt").is_file())
}

#[tauri::command]
pub(super) fn import_youtube_session(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let file = fs::File::open(path).map_err(|_| INVALID_FILE.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_SIZE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| INVALID_FILE.to_string())?;
    if bytes.len() as u64 > MAX_SIZE {
        return Err(INVALID_FILE.into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| INVALID_FILE.to_string())?;
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if !matches!(
        lines.next(),
        Some("# Netscape HTTP Cookie File" | "# HTTP Cookie File")
    ) {
        return Err(INVALID_FILE.into());
    }
    let mut cookies = String::from("# Netscape HTTP Cookie File\r\n");
    let mut count = 0;
    for line in lines {
        let row = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if row.is_empty() || row.starts_with('#') {
            continue;
        }
        let fields: Vec<_> = row.split('\t').collect();
        if fields.len() != 7 {
            return Err(INVALID_FILE.into());
        }
        let domain = fields[0].trim_start_matches('.').to_ascii_lowercase();
        if domain != "youtube.com" && !domain.ends_with(".youtube.com") {
            continue;
        }
        if !matches!(fields[1], "TRUE" | "FALSE")
            || !fields[2].starts_with('/')
            || !matches!(fields[3], "TRUE" | "FALSE")
            || fields[4].parse::<u64>().is_err()
            || fields[5].is_empty()
        {
            return Err(INVALID_FILE.into());
        }
        cookies.push_str(line);
        cookies.push_str("\r\n");
        count += 1;
    }
    if count == 0 {
        return Err(INVALID_FILE.into());
    }
    let dir = folder(&app)?;
    fs::create_dir_all(&dir).map_err(|_| STORAGE_ERROR.to_string())?;
    let temporary = SessionFile {
        path: dir.join(format!("import-{}.cookies.txt", uuid::Uuid::new_v4())),
    };
    write_private(&temporary.path, cookies.as_bytes())?;
    fs::rename(&temporary.path, dir.join("youtube-cookies.txt"))
        .map_err(|_| STORAGE_ERROR.to_string())?;
    Ok(true)
}

#[tauri::command]
pub(super) fn clear_youtube_session(app: tauri::AppHandle) -> Result<bool, String> {
    match fs::remove_file(folder(&app)?.join("youtube-cookies.txt")) {
        Ok(()) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => {
            Err("Не удалось удалить сессию YouTube. Закройте загрузки и попробуйте снова.".into())
        }
    }
}

#[tauri::command]
pub(super) fn open_youtube_session_help() -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = super::command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = super::command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = super::command("xdg-open");
    cmd.kill_on_drop(false)
        .arg("https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies")
        .spawn()
        .map_err(|_| "Не удалось открыть инструкцию в браузере.".to_string())?;
    Ok(())
}
