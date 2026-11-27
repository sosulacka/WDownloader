use super::*;
use std::{fs, io::Write};

pub(super) struct Staging(pub PathBuf);

impl Staging {
    pub(super) fn new(folder: &Path) -> Result<Self, String> {
        let dir = folder.join(format!(".wdownloader-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).map_err(|e| format!("Не удалось подготовить папку: {e}"))?;
        Ok(Self(dir))
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn validated_folder(folder: &str) -> Result<PathBuf, String> {
    let folder = Path::new(folder);
    if !folder.is_absolute() {
        return Err("Выберите папку с абсолютным путём.".into());
    }
    fs::create_dir_all(folder).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    fs::canonicalize(folder).map_err(|e| format!("Папка недоступна: {e}"))
}

// Существующий файл не трогаем, даже если две загрузки завершились одновременно.
pub(super) fn save_unique(source: &Path, target: &Path) -> Result<PathBuf, String> {
    let stem = target
        .file_stem()
        .ok_or("Не удалось определить имя файла.")?
        .to_string_lossy();
    let extension = target
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    for index in 0..=1000 {
        let output = if index == 0 {
            target.to_owned()
        } else {
            target.with_file_name(format!("{stem} ({index}){extension}"))
        };
        match fs::hard_link(source, &output) {
            Ok(()) => return Ok(output),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {}
        }
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        };
        let copied = std::io::copy(&mut input, &mut file).and_then(|_| file.flush());
        drop(file);
        if let Err(e) = copied {
            let _ = fs::remove_file(&output);
            return Err(e.to_string());
        }
        return Ok(output);
    }
    Err("Не удалось подобрать свободное имя файла.".into())
}

fn plain_subtitles(srt: &str) -> String {
    let normalized = srt.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut output = Vec::new();
    let mut in_cue = false;
    for line in normalized.lines().map(str::trim) {
        if line.is_empty() {
            in_cue = false;
        } else if !in_cue && line.contains(" --> ") {
            in_cue = true;
        } else if in_cue {
            let mut clean = String::new();
            let mut tag = false;
            for ch in line.chars() {
                match ch {
                    '<' => tag = true,
                    '>' if tag => tag = false,
                    _ if !tag => clean.push(ch),
                    _ => {}
                }
            }
            let clean = clean
                .replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&");
            let clean = clean.trim();
            if !clean.is_empty() && output.last().is_none_or(|last| last != clean) {
                output.push(clean.to_owned());
            }
        }
    }
    output.join("\n")
}

#[tauri::command]
pub(super) async fn save_extra(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<DownloadState>>,
    url: String,
    folder: String,
    format: String,
    language: Option<String>,
) -> Result<String, String> {
    let url = normalize_url(&url)?;
    let mut args = vec![
        "--skip-download",
        "--windows-filenames",
        "--trim-filenames",
        "160",
    ];
    let language_pattern;
    let extension = match format.as_str() {
        "jpg" | "webp" => {
            args.extend(["--write-thumbnail", "--convert-thumbnails", &format]);
            format.as_str()
        }
        "srt" | "txt" => {
            let language = language
                .as_deref()
                .filter(|lang| platform::valid_language(lang))
                .ok_or("Выберите язык субтитров.")?;
            language_pattern = format!("^{language}$");
            args.extend([
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                &language_pattern,
                "--sub-format",
                "srt/vtt/ttml/best",
                "--convert-subs",
                "srt",
            ]);
            "srt"
        }
        _ => return Err("Неизвестный формат скачивания.".into()),
    };
    let _permit = state
        .extras_slot
        .try_acquire()
        .map_err(|_| "Сохранение уже идёт.")?;
    let folder = validated_folder(&folder)?;
    let staging = Staging::new(&folder)?;
    ytdlp_transport::capture(
        &app,
        &url,
        std::time::Duration::from_secs(90),
        "Платформа не ответила вовремя. Попробуйте ещё раз.",
        |cmd| {
            cmd.args(["--match-filters", "!is_live"]);
            if is_youtube(&url) && extension == "srt" {
                cmd.args(["--extractor-args", "youtube:skip=translated_subs"]);
            }
            cmd.args(&args).arg("-P").arg(&staging.0).args([
                "-o",
                "%(title).120B [%(id).44B].%(ext)s",
                "--",
                &url,
            ]);
        },
    )
    .await?;
    let mut path = fs::read_dir(&staging.0)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|p| p.is_file() && p.extension().is_some_and(|ext| ext == extension))
        .ok_or(if extension == "srt" {
            "Субтитры на этом языке недоступны."
        } else {
            "Обложка недоступна."
        })?;
    if format == "txt" {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let transcript = plain_subtitles(&text);
        if transcript.is_empty() {
            return Err("В субтитрах нет текста.".into());
        }
        path.set_extension("txt");
        fs::write(&path, transcript).map_err(|e| e.to_string())?;
    }
    let target = folder.join(path.file_name().ok_or("Не удалось определить имя файла.")?);
    save_unique(&path, &target).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_saves_keep_existing_bytes_and_start_at_one() {
        let stage = Staging::new(&std::env::temp_dir()).unwrap();
        let source = stage.0.join("input.tmp");
        let target = stage.0.join("Название [1080p].mp4");
        fs::write(&target, b"original").unwrap();
        fs::write(&source, b"new").unwrap();
        for n in 1..=3 {
            let saved = save_unique(&source, &target).unwrap();
            assert_eq!(saved, stage.0.join(format!("Название [1080p] ({n}).mp4")));
            assert_eq!(fs::read(saved).unwrap(), b"new");
        }
        assert_eq!(fs::read(target).unwrap(), b"original");
    }

    #[test]
    fn keeps_spoken_numbers_and_removes_srt_structure() {
        let input = "\u{feff}1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>2026</i>\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\n2026\r\n&lt;текст&gt;\r\n";
        assert_eq!(plain_subtitles(input), "2026\n<текст>");
    }
}
