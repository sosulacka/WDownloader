use super::*;
use tokio::io::AsyncReadExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Preview {
    path: String,
    duration: f64,
    peaks: Vec<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewProgress<'a> {
    id: &'a str,
    stage: &'a str,
    progress: Option<f64>,
}

fn emit(app: &tauri::AppHandle, id: &str, stage: &str, progress: Option<f64>) {
    let _ = app.emit(
        "preview-update",
        PreviewProgress {
            id,
            stage,
            progress,
        },
    );
}

async fn process(
    app: &tauri::AppHandle,
    state: &DownloadState,
    id: &str,
    cmd: &mut Command,
    cancel: &mut watch::Receiver<bool>,
    stage: &str,
) -> Result<(), String> {
    if *cancel.borrow() {
        return Err("Подготовка отменена.".into());
    }
    emit(app, id, stage, None);
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    if let Some(pid) = pid {
        state.processes.lock().unwrap().insert(id.into(), pid);
    }
    let mut stdout = BufReader::new(child.stdout.take().ok_or("Нет stdout")?).lines();
    let mut stderr = BufReader::new(child.stderr.take().ok_or("Нет stderr")?).lines();
    let mut out_done = false;
    let mut err_done = false;
    let mut errors = std::collections::VecDeque::new();
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if let Some(pid) = pid { kill_tree(pid); }
                let _ = child.kill().await;
                return Err("Подготовка отменена.".into());
            }
            line = stdout.next_line(), if !out_done => match line.map_err(|e| e.to_string())? {
                Some(line) => {
                    if let Some(data) = line.strip_prefix("WD_PREVIEW:") {
                        let fields: Vec<_> = data.split('|').collect();
                        if fields.len() == 2 {
                            let progress = fields[0].parse::<f64>().ok().zip(fields[1].parse::<f64>().ok()).and_then(|(d,t)| if t > 0.0 { Some((d/t*100.0).clamp(0.0,100.0)) } else { None });
                            emit(app, id, stage, progress);
                        }
                    }
                }
                None => out_done = true,
            },
            line = stderr.next_line(), if !err_done => match line.map_err(|e| e.to_string())? {
                Some(line) => { if errors.len() >= 10 { errors.pop_front(); } errors.push_back(line); }
                None => err_done = true,
            },
        }
        if out_done && err_done {
            break;
        }
    }
    let result = child.wait().await.map_err(|e| e.to_string())?;
    state.processes.lock().unwrap().remove(id);
    if !result.success() {
        return Err(error_message(
            errors
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
                .as_bytes(),
        ));
    }
    Ok(())
}

async fn media_duration(app: &tauri::AppHandle, path: &Path) -> Result<f64, String> {
    let ffprobe = locate(app, "ffprobe").ok_or("Нужен ffprobe. Выполните npm run setup:tools.")?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        command(ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(path)
            .output(),
    )
    .await
    .map_err(|_| "Не удалось определить длительность файла.".to_string())?
    .map_err(|e| e.to_string())?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or("В файле нет доступной медиадорожки.".into())
}

async fn waveform(
    app: &tauri::AppHandle,
    state: &DownloadState,
    id: &str,
    path: &Path,
    duration: f64,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Vec<f32>, String> {
    let ffmpeg = locate(app, "ffmpeg").ok_or("Не найден FFmpeg")?;
    let mut child = command(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "1000", "-f", "f32le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    if let Some(pid) = pid {
        state.processes.lock().unwrap().insert(id.into(), pid);
    }
    let mut stdout = child.stdout.take().ok_or("Нет аудиодорожки")?;
    let mut peaks = vec![0.0f32; 1200];
    let mut buffer = [0u8; 8192];
    let mut pending = Vec::with_capacity(8196);
    let mut samples = 0usize;
    emit(app, id, "waveform", None);
    loop {
        let count = tokio::select! {
            result = stdout.read(&mut buffer) => result.map_err(|e| e.to_string())?,
            _ = cancel.changed() => { if let Some(pid) = pid { kill_tree(pid); } let _ = child.kill().await; return Err("Подготовка отменена.".into()); }
        };
        if count == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..count]);
        let complete = pending.len() / 4 * 4;
        for bytes in pending[..complete].as_chunks::<4>().0 {
            let sample = f32::from_le_bytes(*bytes).abs();
            let index = ((samples as f64 / (duration * 1000.0)) * peaks.len() as f64) as usize;
            if sample.is_finite() {
                let index = index.min(peaks.len() - 1);
                peaks[index] = peaks[index].max(sample);
            }
            samples += 1;
        }
        pending.drain(..complete);
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    state.processes.lock().unwrap().remove(id);
    if !status.success() {
        return Err("Не удалось построить звуковую волну.".into());
    }
    let max = peaks.iter().copied().fold(0.0f32, f32::max).max(0.001);
    peaks.iter_mut().for_each(|p| *p = (*p / max).sqrt());
    Ok(peaks)
}

#[tauri::command]
pub(super) async fn prepare_preview(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
    url: Option<String>,
    job_id: Option<String>,
    kind: String,
    request_id: String,
) -> Result<Preview, String> {
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Некорректный ID предпросмотра")?;
    if !["audio", "video"].contains(&kind.as_str()) {
        return Err("Неизвестный тип медиа".into());
    }
    let (key, source_url, source_file) = match (url, job_id) {
        (Some(url), None) => {
            let url = normalize_url(&url)?;
            let key = url.rsplit('=').next().unwrap().to_string();
            (key, Some(url), None)
        }
        (None, Some(job_id)) => {
            uuid::Uuid::parse_str(&job_id).map_err(|_| "Некорректный ID загрузки")?;
            let jobs = state.jobs.lock().unwrap();
            let job = jobs
                .get(&job_id)
                .filter(|j| j.status == "completed")
                .ok_or("Загрузка не найдена")?;
            let file = job
                .file
                .clone()
                .filter(|f| Path::new(f).is_file())
                .ok_or("Файл был перемещён или удалён")?;
            (format!("job-{job_id}"), None, Some(PathBuf::from(file)))
        }
        _ => return Err("Нужно выбрать видео или готовый файл".into()),
    };
    let state = state.inner().clone();
    let (tx, mut cancel) = watch::channel(false);
    {
        let mut controls = state.controls.lock().unwrap();
        if controls.contains_key(&request_id) {
            return Err("Предпросмотр уже запущен".into());
        }
        controls.insert(request_id.clone(), tx);
    }
    let result = async {
        emit(&app, &request_id, "queued", None);
        let _permit = tokio::select! {
            permit = state.preview_slot.acquire() => permit.map_err(|e| e.to_string())?,
            _ = cancel.changed() => return Err("Подготовка отменена.".into()),
        };
        if *cancel.borrow() { return Err("Подготовка отменена.".into()); }
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("previews");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let extension = if kind == "audio" { "mp3" } else { "mp4" };
        let path = dir.join(format!("{key}-{kind}.{extension}"));
        if !path.is_file() {
            let source = if let Some(url) = source_url {
                let mut cmd = ytdlp(&app)?;
                let raw_template = dir.join(format!("{key}-{kind}-source.%(ext)s"));
                cmd.args(["--newline", "--progress", "--progress-delta", "0.5", "--progress-template", "download:WD_PREVIEW:%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s", "--no-simulate", "--no-warnings", "-o"]).arg(raw_template);
                if kind == "audio" { cmd.args(["-f", "bestaudio[ext=m4a]/bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5"]); }
                else { cmd.args(["-f", "bestvideo[ext=mp4][vcodec^=avc1][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]", "--merge-output-format", "mp4", "--remux-video", "mp4"]); }
                cmd.args(["--", &url]);
                process(&app, &state, &request_id, &mut cmd, &mut cancel, "downloading").await?;
                dir.join(format!("{key}-{kind}-source.{extension}"))
            } else { source_file.unwrap() };
            let ffmpeg = locate(&app, "ffmpeg").ok_or("Нужен FFmpeg для предпросмотра")?;
            let temporary = dir.join(format!("{key}-{request_id}-ready.{extension}"));
            let mut cmd = command(ffmpeg);
            cmd.args(["-v", "error", "-y", "-i"]).arg(&source);
            if kind == "audio" { cmd.args(["-vn", "-c:a", "libmp3lame", "-q:a", "5"]); }
            else { cmd.args(["-vf", "scale=-2:'min(480,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]); }
            cmd.arg(&temporary);
            process(&app, &state, &request_id, &mut cmd, &mut cancel, "processing").await?;
            std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
            if source.starts_with(&dir) { let _ = std::fs::remove_file(source); }
        }
        let duration = media_duration(&app, &path).await?;
        let peaks_path = dir.join(format!("{key}-{kind}-peaks.json"));
        let cached: Option<Vec<f32>> = std::fs::read(&peaks_path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let peaks = if let Some(peaks) = cached { peaks } else {
            let peaks = waveform(&app, &state, &request_id, &path, duration, &mut cancel).await?;
            if let Ok(json) = serde_json::to_vec(&peaks) { let _ = std::fs::write(peaks_path, json); }
            peaks
        };
        app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
        emit(&app, &request_id, "ready", Some(100.0));
        Ok(Preview { path: path.to_string_lossy().into_owned(), duration, peaks })
    }.await;
    state.controls.lock().unwrap().remove(&request_id);
    state.processes.lock().unwrap().remove(&request_id);
    result
}
