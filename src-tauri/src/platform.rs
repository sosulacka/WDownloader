use super::*;

pub(super) fn platform(url: &url::Url) -> Option<&'static str> {
    match url.host_str()? {
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be"
        | "www.youtu.be" => Some("YouTube"),
        "vk.com" | "www.vk.com" | "m.vk.com" | "vk.ru" | "www.vk.ru" | "m.vk.ru" | "vkvideo.ru"
        | "www.vkvideo.ru" => Some("VK Видео"),
        "twitch.tv" | "www.twitch.tv" | "m.twitch.tv" | "go.twitch.tv" | "clips.twitch.tv" => {
            Some("Twitch")
        }
        "tiktok.com" | "www.tiktok.com" | "m.tiktok.com" | "vm.tiktok.com" | "vt.tiktok.com" => {
            Some("TikTok")
        }
        "soundcloud.com" | "www.soundcloud.com" | "m.soundcloud.com" | "on.soundcloud.com"
        | "snd.sc" => Some("SoundCloud"),
        _ => None,
    }
}

pub(super) fn is_youtube(url: &str) -> bool {
    url::Url::parse(url).ok().as_ref().and_then(platform) == Some("YouTube")
}

pub(super) fn normalize_url(input: &str) -> Result<String, String> {
    let mut url =
        url::Url::parse(input.trim()).map_err(|_| "Вставьте полную ссылку на видео или аудио.")?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("Нужна обычная ссылка HTTP или HTTPS.".into());
    }
    let site = platform(&url).ok_or("Эта платформа не поддерживается.")?;
    if site != "YouTube" {
        let path = url.path().trim_matches('/');
        let parts: Vec<_> = path.split('/').collect();
        let allowed = match (site, url.host_str(), parts.as_slice()) {
            ("VK Видео", _, [id]) => {
                id.starts_with("video-")
                    || id.starts_with("clip-")
                    || id
                        .strip_prefix("video")
                        .is_some_and(|id| id.starts_with(|c: char| c.is_ascii_digit()))
                    || id
                        .strip_prefix("clip")
                        .is_some_and(|id| id.starts_with(|c: char| c.is_ascii_digit()))
                    || matches!(*id, "video" | "video_ext.php") && url.query().is_some()
            }
            ("Twitch", Some("clips.twitch.tv"), [clip]) => !clip.is_empty() && *clip != "embed",
            ("Twitch", _, ["videos", id]) => {
                !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit())
            }
            ("Twitch", _, [_, "clip", id]) => !id.is_empty(),
            ("TikTok", Some("vm.tiktok.com" | "vt.tiktok.com"), [id]) => !id.is_empty(),
            ("TikTok", _, ["t", id] | [_, "video", id] | ["v", id]) => !id.is_empty(),
            ("SoundCloud", Some("on.soundcloud.com" | "snd.sc"), [id]) => !id.is_empty(),
            ("SoundCloud", _, [_, track] | [_, track, _]) => {
                !track.is_empty()
                    && !matches!(
                        *track,
                        "sets" | "likes" | "reposts" | "albums" | "tracks" | "popular-tracks"
                    )
            }
            _ => false,
        };
        if !allowed {
            return Err("Вставьте ссылку на отдельное видео или трек.".into());
        }
        url.set_fragment(None);
        return Ok(url.into());
    }
    let id = if matches!(url.host_str(), Some("youtu.be" | "www.youtu.be")) {
        url.path().trim_matches('/').to_owned()
    } else if url.path() == "/watch" {
        url.query_pairs()
            .find(|(k, _)| k == "v")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default()
    } else {
        let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
        match parts.as_slice() {
            ["shorts" | "live" | "embed", id] => (*id).to_owned(),
            _ => String::new(),
        }
    };
    if id.len() != 11
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("Не удалось найти ID видео. Вставьте ссылку на отдельный ролик.".into());
    }
    Ok(format!("https://www.youtube.com/watch?v={id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_media_from_each_platform() {
        for (input, site) in [
            ("https://vkvideo.ru/video-10_20", "VK Видео"),
            ("https://www.twitch.tv/videos/12345678", "Twitch"),
            ("https://clips.twitch.tv/ExampleSlug", "Twitch"),
            ("https://vm.tiktok.com/ExampleSlug/", "TikTok"),
            ("https://soundcloud.com/artist/track/s-secret", "SoundCloud"),
        ] {
            let media = url::Url::parse(&normalize_url(input).unwrap()).unwrap();
            assert_eq!(platform(&media), Some(site));
        }
        assert!(normalize_url("https://soundcloud.com/artist/sets/playlist").is_err());
        assert!(normalize_url("https://www.twitch.tv/example").is_err());
    }
}

pub(super) fn subtitle_languages(info: &Value) -> Vec<String> {
    let mut languages = Vec::new();
    for field in ["subtitles", "automatic_captions"] {
        if let Some(tracks) = info[field].as_object() {
            languages.extend(tracks.keys().filter(|lang| valid_language(lang)).cloned());
        }
    }
    languages.sort();
    languages.dedup();
    languages
}

pub(super) fn valid_language(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 48
        && lang != "live_chat"
        && lang
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SponsorVideo {
    video_id: String,
    segments: Vec<SponsorSegment>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SponsorSegment {
    segment: [f64; 2],
    category: String,
    action_type: String,
}

#[tauri::command]
pub(super) async fn sponsor_segments(url: String) -> Result<Vec<SponsorSegment>, String> {
    use sha2::{Digest, Sha256};

    let url = normalize_url(&url)?;
    if !is_youtube(&url) {
        return Ok(Vec::new());
    }
    let id = url.rsplit('=').next().unwrap_or_default();
    let hash = format!("{:x}", Sha256::digest(id.as_bytes()));
    let message = "Не удалось получить отметки SponsorBlock.";
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| message)?
        .get(format!(
            "https://sponsor.ajay.app/api/skipSegments/{}",
            &hash[..4]
        ))
        .query(&[("categories", r#"["sponsor","intro"]"#)])
        .send()
        .await
        .map_err(|_| message)?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    let bytes = response
        .error_for_status()
        .map_err(|_| message)?
        .bytes()
        .await
        .map_err(|_| message)?;
    let videos: Vec<SponsorVideo> = serde_json::from_slice(&bytes).map_err(|_| message)?;
    let segments = videos
        .into_iter()
        .find(|video| video.video_id == id)
        .map(|video| video.segments)
        .unwrap_or_default();
    Ok(segments
        .into_iter()
        .filter(|s| {
            matches!(s.category.as_str(), "sponsor" | "intro")
                && s.action_type == "skip"
                && s.segment[0] >= 0.0
                && s.segment[1] > s.segment[0]
        })
        .collect())
}
