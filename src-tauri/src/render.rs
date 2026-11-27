use super::*;

pub(super) fn audio_filter(request: &DownloadRequest) -> Option<String> {
    let mut filters = Vec::new();
    if request.enhance_voice {
        filters.push("aformat=channel_layouts=stereo,dialoguenhance=original=0.25:enhance=2,pan=mono|c0=FC,highpass=f=90,lowpass=f=6500");
    }
    if request.remove_silence {
        filters.push("silenceremove=stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB:stop_silence=0.15");
    }
    if request.normalize_audio {
        filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    }
    if filters.is_empty() {
        return None;
    }
    filters.extend(["aresample=48000", "asetnsamples=n=1024:p=0"]);
    Some(filters.join(","))
}

fn audio_args(
    cmd: &mut Command,
    request: &DownloadRequest,
    filter: Option<&str>,
) -> Result<(), String> {
    let codec = match request.format.as_str() {
        "mp3" => "libmp3lame",
        "m4a" | "aac" => "aac",
        "wav" => "pcm_s16le",
        "flac" => "flac",
        "opus" => "libopus",
        "vorbis" => "libvorbis",
        _ => return Err("Неизвестный формат скачивания.".into()),
    };
    cmd.args(["-map", "0:a:0", "-c:a", codec]);
    if let Some(filter) = filter {
        cmd.args(["-af", filter, "-ar", "48000"]);
    }
    if !matches!(request.format.as_str(), "wav" | "flac") {
        // У монофонических Opus и Vorbis есть предел битрейта.
        let max = match request.format.as_str() {
            "opus" => 256,
            "vorbis" => 240,
            _ => 320,
        };
        let quality = request.quality.parse::<u32>().unwrap_or(max).min(max);
        cmd.arg("-b:a").arg(format!("{quality}k"));
    }
    Ok(())
}

fn video_args(cmd: &mut Command, format: &str) {
    cmd.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    ]);
    if format == "webm" {
        cmd.args([
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "28",
            "-b:v",
            "0",
            "-cpu-used",
            "4",
            "-c:a",
            "libopus",
            "-b:a",
            "160k",
        ]);
    } else {
        cmd.args([
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "aac", "-b:a", "192k",
        ]);
    }
}

pub(super) async fn render_media(
    app: &tauri::AppHandle,
    state: &DownloadState,
    job: &Job,
    source: &Path,
    filter: Option<&str>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<PathBuf, String> {
    let ffmpeg = locate(app, "ffmpeg").ok_or("Нужен FFmpeg для обработки файла.")?;
    let request = &job.request;
    let extension = if request.format == "vorbis" {
        "ogg"
    } else {
        &request.format
    };
    let output = source.with_file_name(format!("encoded.{extension}"));
    let mut cmd = command(ffmpeg);
    cmd.args(["-v", "error"]);
    if let Some(clip) = &request.clip {
        cmd.arg("-ss")
            .arg(format!("{:.3}", clip.start))
            .arg("-t")
            .arg(format!("{:.3}", clip.end - clip.start));
    }
    cmd.arg("-i").arg(source);
    if request.kind == "audio" {
        audio_args(&mut cmd, request, filter)?;
    } else {
        video_args(&mut cmd, extension);
    }
    if matches!(extension, "mp4" | "mov" | "m4a") {
        cmd.args(["-movflags", "+faststart"]);
    }
    if !request.metadata || request.clip.is_some() {
        cmd.args(["-map_chapters", "-1"]);
    }
    if request.metadata {
        cmd.arg("-metadata").arg(format!("title={}", request.title));
    } else {
        cmd.args(["-map_metadata", "-1"]);
    }
    let mut child = cmd
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Не удалось запустить FFmpeg: {e}"))?;
    if let Some(pid) = child.id() {
        state.processes.lock().unwrap().insert(job.id.clone(), pid);
    }
    let mut stderr = child.stderr.take().ok_or("Не удалось открыть stderr")?;
    let mut errors = Vec::new();
    let result = tokio::select! {
        biased;
        _ = cancel.changed() => {
            let _ = child.kill().await;
            Err("Обработка отменена.".into())
        }
        result = async {
            use tokio::io::AsyncReadExt;
            stderr.read_to_end(&mut errors).await.map_err(|e| e.to_string())?;
            child.wait().await.map_err(|e| e.to_string())
        } => result,
    };
    state.processes.lock().unwrap().remove(&job.id);
    if !result?.success() {
        return Err(error_message(&errors, ""));
    }
    if *cancel.borrow() {
        return Err("Обработка отменена.".into());
    }
    Ok(output)
}
