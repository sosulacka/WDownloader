use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{watch, Semaphore},
};
mod render;
use render::{audio_filter, render_media};
mod extras;
mod installer;
mod platform;
use platform::{is_youtube, normalize_url};
mod output;
mod preview;
mod youtube_login;
mod youtube_session;
mod ytdlp_transport;
mod ytdlp_update;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipRange {
    start: f64,
    end: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRequest {
    url: String,
    title: String,
    kind: String,
    format: String,
    quality: String,
    folder: String,
    metadata: bool,
    #[serde(default)]
    clip: Option<ClipRange>,
    #[serde(default)]
    sponsor_block: bool,
    #[serde(default)]
    normalize_audio: bool,
    #[serde(default)]
    remove_silence: bool,
    #[serde(default)]
    enhance_voice: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    request: DownloadRequest,
    status: String,
    progress: f64,
    speed: Option<f64>,
    eta: Option<f64>,
    file: Option<String>,
    error: Option<String>,
    created: u64,
}

struct DownloadState {
    jobs: Mutex<HashMap<String, Job>>,
    controls: Mutex<HashMap<String, watch::Sender<bool>>>,
    processes: Mutex<HashMap<String, u32>>,
    slot: Semaphore,
    preview_slot: Semaphore,
    extras_slot: Semaphore,
    install_slot: Semaphore,
    history: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Dependencies {
    yt_dlp: Option<String>,
    ffmpeg: Option<String>,
    ffprobe: Option<String>,
    deno: Option<String>,
    folder: String,
    tools_folder: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoInfo {
    id: String,
    url: String,
    title: String,
    channel: String,
    duration: f64,
    thumbnail: String,
    heights: Vec<u64>,
    views: Option<u64>,
    platform: &'static str,
    has_video: bool,
    has_audio: bool,
    subtitles: Vec<String>,
}

fn command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(path);
    cmd.kill_on_drop(true).stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}

fn locate(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let executable = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let mut dirs = Vec::new();
    if let Ok(dir) = app.path().app_local_data_dir() {
        dirs.push(dir.join("tools"));
    }
    if let Ok(dir) = app.path().resource_dir() {
        dirs.push(dir.join("tools"));
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools"));
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter()
        .map(|d| d.join(&executable))
        .find(|p| p.is_file())
}

fn ytdlp(
    app: &tauri::AppHandle,
    url: &str,
) -> Result<(Command, Option<youtube_session::SessionFile>), String> {
    let path = locate(app, "yt-dlp")
        .ok_or("Не найден yt-dlp. Повторите установку компонентов в настройках приложения.")?;
    let mut cmd = command(path);
    cmd.args([
        "--ignore-config",
        "--no-playlist",
        "--playlist-items",
        "1",
        "--no-colors",
        "--encoding",
        "utf-8",
        "--socket-timeout",
        "20",
        "--retries",
        "3",
        "--extractor-retries",
        "2",
    ]);
    // Кэш yt-dlp (расшифровка подписи плеера) между запусками: следующие запросы быстрее.
    if let Ok(dir) = app.path().app_cache_dir() {
        cmd.arg("--cache-dir").arg(dir.join("yt-dlp"));
    }
    if let Some(path) = locate(app, "ffmpeg") {
        cmd.arg("--ffmpeg-location").arg(path);
    }
    if let Some(path) = locate(app, "deno") {
        cmd.arg("--js-runtimes")
            .arg(format!("deno:{}", path.display()));
    }
    let session = if is_youtube(url) {
        youtube_session::prepare(app)?
    } else {
        None
    };
    if let Some(session) = &session {
        cmd.arg("--cookies").arg(&session.path);
    }
    Ok((cmd, session))
}

fn default_folder(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Wdownloader")
}

#[tauri::command]
fn check_dependencies(app: tauri::AppHandle) -> Dependencies {
    let show = |n| locate(&app, n).map(|p| p.to_string_lossy().into_owned());
    Dependencies {
        yt_dlp: show("yt-dlp"),
        ffmpeg: show("ffmpeg"),
        ffprobe: show("ffprobe"),
        deno: show("deno"),
        folder: default_folder(&app).to_string_lossy().into_owned(),
        tools_folder: app
            .path()
            .app_local_data_dir()
            .map(|p| p.join("tools").to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

fn error_message(stderr: &[u8], url: &str) -> String {
    let text = String::from_utf8_lossy(stderr);
    let lower = text.to_lowercase();
    if lower.contains("getaddrinfo failed")
        || lower.contains("failed to resolve")
        || lower.contains("name or service not known")
    {
        return "Не удалось найти адрес платформы. Проверьте подключение и попробуйте ещё раз."
            .into();
    }
    if is_youtube(url)
        && (lower.contains("sign in to confirm")
            || lower.contains("confirm you're not a bot")
            || lower.contains("confirm you’re not a bot"))
    {
        return "YouTube просит подтвердить, что вы не бот. Войдите в YouTube или импортируйте сессию в настройках.".into();
    }
    if let Some(message) = ytdlp_transport::connection_message(&text) {
        return message.into();
    }
    if lower.contains("connectionreseterror")
        || lower.contains("connection was reset")
        || lower.contains("winerror 10054")
    {
        return "Соединение с платформой сброшено. Попробуйте ещё раз или откройте ссылку в браузере.".into();
    }
    text.lines()
        .rev()
        .find(|l| l.contains("ERROR:"))
        .or_else(|| text.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("Не удалось обработать видео. Проверьте подключение и обновите yt-dlp.")
        .chars()
        .take(900)
        .collect()
}

#[tauri::command]
async fn inspect_video(app: tauri::AppHandle, url: String) -> Result<VideoInfo, String> {
    let url = normalize_url(&url)?;
    let output = ytdlp_transport::capture(
        &app,
        &url,
        std::time::Duration::from_secs(60),
        "Платформа не ответила за 60 секунд. Попробуйте ещё раз.",
        |cmd| {
            cmd.args([
                "--dump-single-json",
                "--skip-download",
                "--no-check-formats",
            ]);
            if is_youtube(&url) {
                cmd.args(["--extractor-args", "youtube:skip=translated_subs"]);
            }
            cmd.args(["--", &url]);
        },
    )
    .await?;
    let v: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "yt-dlp вернул некорректные данные.".to_string())?;
    if v["is_live"].as_bool() == Some(true) {
        return Err("Дождитесь окончания трансляции, затем скачайте запись.".into());
    }
    if v["_type"] == "playlist" || v["entries"].is_array() {
        return Err("Вставьте ссылку на отдельное видео или трек.".into());
    }
    let site =
        platform::platform(&url::Url::parse(&url).map_err(|e| e.to_string())?).unwrap_or("Медиа");
    let formats = v["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(std::iter::once(&v));
    let playable = formats.filter(|f| f["has_drm"].as_bool() != Some(true));
    let video_codec = |f: &Value| match f["vcodec"].as_str() {
        Some(codec) => codec != "none" && !codec.is_empty(),
        None => {
            f["height"].as_u64().is_some()
                || matches!(
                    f["ext"].as_str(),
                    Some("mp4" | "mov" | "webm" | "mkv" | "flv")
                )
        }
    };
    let audio_codec = |f: &Value| match f["acodec"].as_str() {
        Some(codec) => codec != "none" && !codec.is_empty(),
        None => {
            f["url"].is_string()
                && (video_codec(f)
                    || site == "SoundCloud"
                    || matches!(
                        f["ext"].as_str(),
                        Some("m4a" | "mp3" | "aac" | "wav" | "opus" | "flac" | "ogg")
                    ))
        }
    };
    let has_video = playable.clone().any(video_codec);
    let has_audio = playable.clone().any(audio_codec);
    if !has_video && !has_audio {
        return Err("У файла нет доступных дорожек.".into());
    }
    let mut heights: Vec<u64> = playable
        .filter(|f| video_codec(f))
        .filter_map(|f| f["height"].as_u64())
        .collect();
    heights.sort_unstable_by(|a, b| b.cmp(a));
    heights.dedup();
    let id = v["id"].as_str().unwrap_or_default().to_string();
    Ok(VideoInfo {
        thumbnail: v["thumbnail"]
            .as_str()
            .and_then(|value| url::Url::parse(value).ok())
            .filter(|thumb| {
                thumb.scheme() == "https"
                    && thumb.username().is_empty()
                    && thumb.password().is_none()
            })
            .map(String::from)
            .unwrap_or_default(),
        platform: site,
        has_video,
        has_audio,
        subtitles: platform::subtitle_languages(&v),
        id,
        url,
        title: v["title"].as_str().unwrap_or("Видео без названия").into(),
        channel: v["channel"]
            .as_str()
            .or(v["uploader"].as_str())
            .unwrap_or(site)
            .into(),
        duration: v["duration"].as_f64().unwrap_or(0.0),
        heights,
        views: v["view_count"].as_u64(),
    })
}

fn validate_request(request: &mut DownloadRequest) -> Result<(), String> {
    request.url = normalize_url(&request.url)?;
    validate_clip(request.clip.as_ref())?;
    if request.sponsor_block && (!is_youtube(&request.url) || request.clip.is_some()) {
        return Err("SponsorBlock доступен для целого видео с YouTube.".into());
    }
    if request.kind != "audio" && audio_filter(request).is_some() {
        return Err("Обработка звука доступна в режиме аудио.".into());
    }
    let allowed = match request.kind.as_str() {
        "video" => ["mp4", "mkv", "webm", "mov"].contains(&request.format.as_str()),
        "audio" => ["mp3", "m4a", "wav", "flac", "opus", "aac", "vorbis"]
            .contains(&request.format.as_str()),
        _ => false,
    };
    if !allowed {
        return Err("Неизвестный формат скачивания.".into());
    }
    if request.kind == "video" {
        if request.quality != "best"
            && !request
                .quality
                .parse::<u32>()
                .is_ok_and(|n| (1..=16384).contains(&n))
        {
            return Err("Некорректное разрешение видео.".into());
        }
    } else if !["best", "320", "256", "192", "128"].contains(&request.quality.as_str()) {
        return Err("Некорректное качество аудио.".into());
    }
    request.folder = extras::validated_folder(&request.folder)?
        .to_string_lossy()
        .into_owned();
    request.title = request.title.chars().take(250).collect();
    Ok(())
}

fn validate_clip(clip: Option<&ClipRange>) -> Result<(), String> {
    if let Some(clip) = clip {
        if !clip.start.is_finite()
            || !clip.end.is_finite()
            || clip.start < 0.0
            || clip.end - clip.start < 0.099
            || clip.end > 604800.0
        {
            return Err("Проверьте границы фрагмента: конец должен быть позже начала минимум на 0,1 секунды.".into());
        }
    }
    Ok(())
}

fn format_args(request: &DownloadRequest) -> Vec<String> {
    if request.kind == "audio" {
        return vec![
            "-f".into(),
            "bestaudio/best".into(),
            "--extract-audio".into(),
            "--audio-format".into(),
            request.format.clone(),
            "--audio-quality".into(),
            if request.quality == "best" {
                "0".into()
            } else {
                format!("{}K", request.quality)
            },
        ];
    }
    let limit = if request.quality == "best" {
        String::new()
    } else {
        format!("[height<= {}]", request.quality).replace(' ', "")
    };
    let fallback = format!("bestvideo{limit}+bestaudio/best{limit}/bestvideo{limit}");
    let (selection, merge, conversion) = match request.format.as_str() {
        "webm" => (
            format!(
                "bestvideo[ext=webm]{limit}+bestaudio[ext=webm]/best[ext=webm]{limit}/{fallback}"
            ),
            "webm/mkv",
            "--recode-video",
        ),
        "mp4" | "mov" => (
            format!("bestvideo[ext=mp4]{limit}+bestaudio[ext=m4a]/best[ext=mp4]{limit}/{fallback}"),
            "mp4/mkv",
            "--recode-video",
        ),
        _ => (fallback, "mkv", "--remux-video"),
    };
    let mut args = vec![
        "-f".into(),
        selection,
        "--merge-output-format".into(),
        merge.into(),
    ];
    if request.clip.is_none() {
        args.extend([conversion.into(), request.format.clone()]);
    }
    args
}

fn publish(app: &tauri::AppHandle, state: &DownloadState, id: &str, update: impl FnOnce(&mut Job)) {
    let mut jobs = state.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(id) {
        update(job);
        let _ = app.emit("download-update", &*job);
        if ["completed", "failed", "cancelled"].contains(&job.status.as_str()) {
            if let Ok(json) = serde_json::to_vec(&*jobs) {
                let _ = std::fs::write(&state.history, json);
            }
        }
    }
}

#[tauri::command]
fn get_jobs(state: tauri::State<'_, Arc<DownloadState>>) -> Vec<Job> {
    let mut jobs: Vec<_> = state.jobs.lock().unwrap().values().cloned().collect();
    jobs.sort_by_key(|j| std::cmp::Reverse(j.created));
    jobs
}

#[tauri::command]
fn start_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
    mut request: DownloadRequest,
) -> Result<Job, String> {
    validate_request(&mut request)?;
    if locate(&app, "ffmpeg").is_none() {
        return Err(
            "Нужен FFmpeg для объединения и конвертации. Выполните npm run setup:tools.".into(),
        );
    }
    if locate(&app, "yt-dlp").is_none() {
        return Err(
            "Не найден yt-dlp. Повторите установку компонентов в настройках приложения.".into(),
        );
    }
    let state = state.inner().clone();
    let job = Job {
        id: uuid::Uuid::new_v4().to_string(),
        request,
        status: "queued".into(),
        progress: 0.0,
        speed: None,
        eta: None,
        file: None,
        error: None,
        created: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };
    {
        let mut jobs = state.jobs.lock().unwrap();
        if jobs
            .values()
            .filter(|j| ["queued", "downloading", "processing"].contains(&j.status.as_str()))
            .count()
            >= 50
        {
            return Err("В очереди уже 50 загрузок. Дождитесь завершения части файлов.".into());
        }
        jobs.insert(job.id.clone(), job.clone());
        if let Ok(json) = serde_json::to_vec(&*jobs) {
            let _ = std::fs::write(&state.history, json);
        }
    }
    let (tx, rx) = watch::channel(false);
    state.controls.lock().unwrap().insert(job.id.clone(), tx);
    let task_job = job.clone();
    tauri::async_runtime::spawn(async move {
        let id = task_job.id.clone();
        if let Err(error) = download_worker(&app, &state, &task_job, rx).await {
            publish(&app, &state, &id, |j| {
                j.status = "failed".into();
                j.error = Some(error);
                j.speed = None;
                j.eta = None;
            });
        }
        state.controls.lock().unwrap().remove(&id);
        state.processes.lock().unwrap().remove(&id);
    });
    Ok(job)
}

async fn download_worker(
    app: &tauri::AppHandle,
    state: &DownloadState,
    job: &Job,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    let id = &job.id;
    let _permit = tokio::select! {
        permit = state.slot.acquire() => permit.map_err(|e| e.to_string())?,
        _ = cancel.changed() => { publish(app, state, id, |j| j.status = "cancelled".into()); return Ok(()); }
    };
    if *cancel.borrow() {
        publish(app, state, id, |j| j.status = "cancelled".into());
        return Ok(());
    }
    let folder = Path::new(&job.request.folder);
    let filter = audio_filter(&job.request);
    let staging = extras::Staging::new(folder)?;
    let resume = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|cache| output::resume_folder(&cache, folder, &job.request))
        .transpose()?
        .flatten();
    let render_locally = filter.is_some() || job.request.clip.is_some();
    let clip_suffix = job
        .request
        .clip
        .as_ref()
        .map(|clip| format!(" [{:.1}-{:.1}s]", clip.start, clip.end))
        .unwrap_or_default();
    let sponsor = if job.request.sponsor_block {
        " [SponsorBlock]"
    } else {
        ""
    };
    let mut processed = String::new();
    for (enabled, label) in [
        (job.request.normalize_audio, " [LUFS]"),
        (job.request.remove_silence, " [no pauses]"),
        (job.request.enhance_voice, " [speech]"),
    ] {
        if enabled {
            processed.push_str(label);
        }
    }
    let output_template = format!(
        "%(title).120B [%(extractor_key).16B-%(id).25B]{clip_suffix}{sponsor}{processed}.%(ext)s"
    );
    let (mut cmd, _session) = ytdlp(app, &job.request.url)?;
    cmd.args(["--newline", "--no-simulate", "--progress", "--progress-delta", "0.3", "--progress-template",
        "download:WD_PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.status)s",
        "--print", "after_move:WD_FILE:%(filepath)s", "--windows-filenames", "--trim-filenames", "180", "--no-overwrites", "-o", &output_template]);
    cmd.arg("-P").arg(&staging.0);
    if let Some(resume) = &resume {
        let mut temp_path = std::ffi::OsString::from("temp:");
        temp_path.push(&resume.path);
        cmd.arg("-P").arg(temp_path);
    }
    if render_locally && job.request.kind == "audio" {
        cmd.args(["-f", "bestaudio/best"]);
    } else {
        cmd.args(format_args(&job.request));
    }
    if job.request.sponsor_block {
        cmd.args([
            "--sponsorblock-remove",
            "sponsor,intro",
            "--force-keyframes-at-cuts",
        ]);
    }
    if job.request.metadata && !render_locally {
        cmd.arg("--embed-metadata");
    }
    cmd.args(["--match-filters", "!is_live", "--", &job.request.url]);
    let result = run_download_command(app, state, job, &mut cmd, &mut cancel).await;
    if result.is_err() && *cancel.borrow() {
        publish(app, state, id, |j| {
            j.status = "cancelled".into();
            j.speed = None;
            j.eta = None;
        });
        return Ok(());
    }
    result?;
    if let Some(resume) = resume {
        let _ = std::fs::remove_dir(&resume.path);
    }
    let file = state
        .jobs
        .lock()
        .unwrap()
        .get(id)
        .and_then(|j| j.file.clone());
    let file = file
        .map(PathBuf::from)
        .and_then(|path| std::fs::canonicalize(path).ok())
        .filter(|path| path.parent() == Some(staging.0.as_path()) && path.is_file())
        .ok_or("Загрузка завершилась, но итоговый файл не найден.")?;
    publish(app, state, id, |j| {
        j.status = "processing".into();
        j.file = None;
        j.speed = None;
        j.eta = None;
    });
    let final_media = if render_locally {
        let result = render_media(app, state, job, &file, filter.as_deref(), &mut cancel).await;
        if result.is_err() && *cancel.borrow() {
            publish(app, state, id, |j| j.status = "cancelled".into());
            return Ok(());
        }
        result?
    } else {
        file.clone()
    };
    let info = output::probe(app, &final_media).await;
    if *cancel.borrow() {
        publish(app, state, id, |j| j.status = "cancelled".into());
        return Ok(());
    }
    if job.request.clip.is_some() && info.as_ref().and_then(output::duration).is_none() {
        return Err("В выбранном фрагменте нет медиа. Проверьте границы обрезки.".into());
    }
    let target = folder.join(output::target_name(
        &file,
        &final_media,
        info.as_ref(),
        &job.request.kind,
    )?);
    let file = tauri::async_runtime::spawn_blocking(move || {
        let _staging = staging;
        extras::save_unique(&final_media, &target)
    })
    .await
    .map_err(|e| e.to_string())??;
    publish(app, state, id, |j| {
        j.file = Some(file.to_string_lossy().into_owned());
        j.status = "completed".into();
        j.progress = 100.0;
        j.speed = None;
        j.eta = None;
    });
    Ok(())
}

async fn run_download_command(
    app: &tauri::AppHandle,
    state: &DownloadState,
    job: &Job,
    cmd: &mut Command,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let id = job.id.as_str();
    if *cancel.borrow() {
        return Err("Загрузка отменена.".into());
    }
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить загрузку: {e}"))?;
    let pid = child.id();
    if let Some(pid) = pid {
        state.processes.lock().unwrap().insert(id.to_owned(), pid);
    }
    let mut stdout = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| "Не удалось открыть stdout".to_owned())?,
    )
    .lines();
    let mut stderr = BufReader::new(
        child
            .stderr
            .take()
            .ok_or_else(|| "Не удалось открыть stderr".to_owned())?,
    )
    .lines();
    let mut errors = std::collections::VecDeque::new();
    let mut out_done = false;
    let mut err_done = false;
    publish(app, state, id, |j| {
        j.status = "downloading".into();
        j.progress = 0.0;
        j.file = None;
        j.speed = None;
        j.eta = None;
    });
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if let Some(pid) = pid { kill_tree(pid); }
                let _ = child.kill().await;
                return Err("Загрузка отменена.".into());
            }
            line = stdout.next_line(), if !out_done => {
                match line.map_err(|e| e.to_string())? {
                    Some(line) => handle_line(app, state, id, &line),
                    None => out_done = true,
                }
            }
            line = stderr.next_line(), if !err_done => {
                match line.map_err(|e| e.to_string())? {
                    Some(line) => {
                        handle_line(app, state, id, &line);
                        if errors.len() >= 15 { errors.pop_front(); }
                        errors.push_back(line);
                    }
                    None => err_done = true,
                }
            }
        }
        if out_done && err_done {
            break;
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    state.processes.lock().unwrap().remove(id);
    if !status.success() {
        return Err(error_message(
            errors.make_contiguous().join("\n").as_bytes(),
            &job.request.url,
        ));
    }
    Ok(())
}

fn handle_line(app: &tauri::AppHandle, state: &DownloadState, id: &str, line: &str) {
    if let Some(file) = line.strip_prefix("WD_FILE:") {
        publish(app, state, id, |j| j.file = Some(file.trim().to_string()));
    } else if let Some(data) = line.strip_prefix("WD_PROGRESS:") {
        let fields: Vec<_> = data.split('|').collect();
        if fields.len() != 5 {
            return;
        }
        let number = |i: usize| {
            fields[i]
                .parse::<f64>()
                .ok()
                .filter(|n| n.is_finite() && *n >= 0.0)
        };
        publish(app, state, id, |j| {
            j.status = if fields[4] == "finished" {
                "processing"
            } else {
                "downloading"
            }
            .into();
            j.progress = match (number(0), number(1)) {
                (Some(d), Some(t)) if t > 0.0 => (d / t * 100.0).clamp(0.0, 100.0),
                _ => 0.0,
            };
            j.speed = number(2);
            j.eta = number(3);
        });
    } else if line.starts_with("[Merger]")
        || line.starts_with("[ExtractAudio]")
        || line.starts_with("[VideoRemuxer]")
        || line.starts_with("[Metadata]")
    {
        publish(app, state, id, |j| {
            j.status = "processing".into();
            j.speed = None;
            j.eta = None;
        });
    }
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .creation_flags(0x08000000)
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

#[tauri::command]
fn cancel_download(state: tauri::State<'_, Arc<DownloadState>>, id: String) -> Result<(), String> {
    if let Some(tx) = state.controls.lock().unwrap().get(&id) {
        let _ = tx.send(true);
    }
    Ok(())
}

#[tauri::command]
fn clear_history(state: tauri::State<'_, Arc<DownloadState>>) {
    let mut jobs = state.jobs.lock().unwrap();
    jobs.retain(|_, j| ["queued", "downloading", "processing"].contains(&j.status.as_str()));
    if let Ok(json) = serde_json::to_vec(&*jobs) {
        let _ = std::fs::write(&state.history, json);
    }
}

#[tauri::command]
fn open_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
    id: Option<String>,
    folder: Option<String>,
) -> Result<(), String> {
    let folder = if let Some(id) = id {
        let jobs = state.jobs.lock().unwrap();
        let job = jobs.get(&id).ok_or("Загрузка не найдена")?;
        job.file
            .as_ref()
            .and_then(|f| Path::new(f).parent())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(&job.request.folder))
    } else if let Some(folder) = folder.filter(|folder| !folder.is_empty()) {
        extras::validated_folder(&folder)?
    } else {
        default_folder(&app)
    };
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut cmd = command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = command("xdg-open");
    cmd.kill_on_drop(false)
        .arg(folder)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let history = dir.join("history.json");
            let mut jobs: HashMap<String, Job> = std::fs::read(&history)
                .ok()
                .and_then(|data| serde_json::from_slice(&data).ok())
                .unwrap_or_default();
            for job in jobs.values_mut() {
                if ["queued", "downloading", "processing"].contains(&job.status.as_str()) {
                    job.status = "failed".into();
                    job.error = Some(
                        "Приложение было закрыто. Нажмите повтор, чтобы продолжить загрузку."
                            .into(),
                    );
                }
            }
            app.manage(Arc::new(DownloadState {
                jobs: Mutex::new(jobs),
                controls: Mutex::new(HashMap::new()),
                processes: Mutex::new(HashMap::new()),
                slot: Semaphore::new(1),
                preview_slot: Semaphore::new(1),
                extras_slot: Semaphore::new(1),
                install_slot: Semaphore::new(1),
                history,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dependencies,
            youtube_session::youtube_session_connected,
            youtube_session::import_youtube_session,
            youtube_session::clear_youtube_session,
            youtube_session::open_youtube_session_help,
            youtube_login::youtube_login,
            youtube_login::open_in_browser,
            ytdlp_update::update_ytdlp,
            inspect_video,
            extras::save_extra,
            platform::sponsor_segments,
            get_jobs,
            start_download,
            cancel_download,
            clear_history,
            open_folder,
            preview::prepare_preview,
            installer::ensure_dependencies,
            installer::open_tool_download
        ])
        .build(tauri::generate_context!())
        .expect("Не удалось запустить Wdownloader");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<Arc<DownloadState>>();
            for tx in state.controls.lock().unwrap().values() {
                let _ = tx.send(true);
            }
            for pid in state.processes.lock().unwrap().values() {
                kill_tree(*pid);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_video_links_and_discards_playlist() {
        for input in [
            "https://youtu.be/BaW_jenozKc?t=3",
            "https://www.youtube.com/watch?v=BaW_jenozKc&list=PLtest",
            "https://youtube.com/shorts/BaW_jenozKc",
            "https://music.youtube.com/watch?v=BaW_jenozKc",
        ] {
            assert_eq!(
                normalize_url(input).unwrap(),
                "https://www.youtube.com/watch?v=BaW_jenozKc"
            );
        }
    }

    #[test]
    fn rejects_unrelated_hosts_playlists_and_injection() {
        for input in [
            "https://youtube.com.evil.org/watch?v=BaW_jenozKc",
            "file:///etc/passwd",
            "https://youtube.com/playlist?list=123",
            "--exec calc.exe",
            "https://youtube.com/watch?v=a&v=b",
            "https://user@youtube.com/watch?v=BaW_jenozKc",
        ] {
            assert!(normalize_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn format_selection_respects_resolution_and_container() {
        let mut r = DownloadRequest {
            url: String::new(),
            title: String::new(),
            kind: "video".into(),
            format: "mp4".into(),
            quality: "1080".into(),
            folder: String::new(),
            metadata: true,
            clip: None,
            sponsor_block: false,
            normalize_audio: false,
            remove_silence: false,
            enhance_voice: false,
        };
        assert_eq!(format_args(&r)[1], "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo[height<=1080]");
        r.clip = Some(ClipRange {
            start: 1.2,
            end: 4.5,
        });
        assert!(!format_args(&r).contains(&"--recode-video".to_string()));
        r.kind = "audio".into();
        r.format = "mp3".into();
        r.quality = "320".into();
        assert!(format_args(&r).contains(&"320K".to_string()));
    }

    #[test]
    fn validates_clip_boundaries() {
        assert!(validate_clip(Some(&ClipRange {
            start: 4.9,
            end: 151.5
        }))
        .is_ok());
        for (start, end) in [
            (-1.0, 10.0),
            (10.0, 5.0),
            (2.0, 2.0),
            (0.0, f64::NAN),
            (f64::INFINITY, 10.0),
        ] {
            assert!(validate_clip(Some(&ClipRange { start, end })).is_err());
        }
    }

    #[test]
    fn reads_m4a_clip_from_old_history() {
        let request: DownloadRequest = serde_json::from_value(serde_json::json!({
            "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            "title": "Тестовый фрагмент",
            "kind": "audio",
            "format": "m4a",
            "quality": "best",
            "folder": "C:/Downloads",
            "metadata": true,
            "clip": { "start": 62.7, "end": 164.2 }
        }))
        .unwrap();
        assert_eq!(request.format, "m4a");
        assert!(audio_filter(&request).is_none());
        assert!(!request.sponsor_block);
        let clip = request.clip.unwrap();
        assert_eq!((clip.start, clip.end), (62.7, 164.2));
    }
}
