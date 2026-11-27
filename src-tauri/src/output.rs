use super::*;
use sha2::{Digest, Sha256};

pub(super) struct ResumeFolder {
    pub path: PathBuf,
    _lock: std::fs::File,
}

pub(super) fn resume_folder(
    cache: &Path,
    folder: &Path,
    request: &DownloadRequest,
) -> Result<Option<ResumeFolder>, String> {
    let key = serde_json::to_vec(request).map_err(|err| err.to_string())?;
    let hash = format!("{:x}", Sha256::digest(&key));
    let locks = cache.join("download-locks");
    let lock = std::fs::create_dir_all(&locks).and_then(|()| {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(locks.join(&hash))
    });
    let Ok(lock) = lock else { return Ok(None) };
    if lock.try_lock().is_err() {
        return Ok(None);
    }
    let dir = folder.join(format!(".wd-part-{}", &hash[..32]));
    match std::fs::create_dir(&dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            if !dir.is_dir() || std::fs::canonicalize(&dir).ok().as_ref() != Some(&dir) {
                return Err("Папка для частичной загрузки недоступна.".into());
            }
        }
        Err(err) => return Err(format!("Не удалось подготовить папку для загрузки: {err}")),
    }
    Ok(Some(ResumeFolder {
        path: dir,
        _lock: lock,
    }))
}

pub(super) async fn probe(app: &tauri::AppHandle, path: &Path) -> Option<Value> {
    let ffprobe = locate(app, "ffprobe")?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        command(ffprobe)
            .args([
                "-v", "error", "-show_entries",
                "format=duration:stream=codec_type,width,height,avg_frame_rate,bit_rate,sample_rate:stream_disposition=attached_pic",
                "-of", "json",
            ])
            .arg(path)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if output.status.success() {
        serde_json::from_slice(&output.stdout).ok()
    } else {
        None
    }
}

pub(super) fn duration(info: &Value) -> Option<f64> {
    info["format"]["duration"]
        .as_str()?
        .parse::<f64>()
        .ok()
        .filter(|duration| duration.is_finite() && *duration > 0.0)
}

fn numeric_string(value: &Value) -> Option<u64> {
    value.as_str()?.parse::<u64>().ok().filter(|n| *n > 0)
}

fn media_label(info: &Value, kind: &str) -> Option<String> {
    let stream = info["streams"].as_array()?.iter().find(|stream| {
        stream["codec_type"].as_str() == Some(kind)
            && stream["disposition"]["attached_pic"].as_u64() != Some(1)
    })?;
    if kind == "video" {
        let width = stream["width"].as_u64().filter(|n| *n > 0)?;
        let height = stream["height"].as_u64().filter(|n| *n > 0)?;
        let mut resolution = if width > height {
            format!("{height}p")
        } else {
            format!("{width}x{height}")
        };
        if let Some((n, d)) = stream["avg_frame_rate"]
            .as_str()
            .and_then(|rate| rate.split_once('/'))
        {
            if let (Ok(n), Ok(d)) = (n.parse::<f64>(), d.parse::<f64>()) {
                let fps = n / d;
                if (1.0..=1000.0).contains(&fps) {
                    resolution.push_str(&format!(" {fps:.0}fps"));
                }
            }
        }
        Some(resolution)
    } else {
        numeric_string(&stream["bit_rate"])
            .map(|bits| format!("{:.0}kbps", bits as f64 / 1000.0))
            .or_else(|| {
                numeric_string(&stream["sample_rate"]).map(|samples| format!("{}Hz", samples))
            })
    }
}

pub(super) fn target_name(
    source: &Path,
    output: &Path,
    info: Option<&Value>,
    kind: &str,
) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or("Не удалось определить имя файла.")?;
    let extension = output
        .extension()
        .and_then(|name| name.to_str())
        .ok_or("Не удалось определить формат файла.")?;
    let quality = info.and_then(|info| media_label(info, kind));
    Ok(PathBuf::from(match quality {
        Some(label) => format!("{stem} [{label}].{extension}"),
        None => format!("{stem}.{extension}"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn labels_final_resolution_and_skips_cover_streams() {
        let info = json!({"streams": [
            {"codec_type": "video", "width": 200, "height": 200, "disposition": {"attached_pic": 1}},
            {"codec_type": "video", "width": 1920, "height": 1080, "avg_frame_rate": "60000/1001"},
            {"codec_type": "audio", "bit_rate": "191998", "sample_rate": "48000"}
        ]});
        let src = Path::new("Ролик [id] [01.2-02.5s].webm");
        let dest = Path::new("encoded.mp4");
        assert_eq!(
            target_name(src, dest, Some(&info), "video").unwrap(),
            Path::new("Ролик [id] [01.2-02.5s] [1080p 60fps].mp4")
        );
        assert_eq!(media_label(&info, "audio").as_deref(), Some("192kbps"));
        assert_eq!(
            target_name(src, dest, None, "video").unwrap(),
            Path::new("Ролик [id] [01.2-02.5s].mp4")
        );
    }

    #[test]
    fn labels_portrait_and_audio_without_bitrate() {
        let info = json!({"streams": [
            {"codec_type": "video", "width": 720, "height": 1280, "avg_frame_rate": "0/0"},
            {"codec_type": "audio", "sample_rate": "44100"}
        ]});
        assert_eq!(media_label(&info, "video").as_deref(), Some("720x1280"));
        assert_eq!(media_label(&info, "audio").as_deref(), Some("44100Hz"));
    }
}
