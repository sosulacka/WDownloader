use super::*;
use std::{process::Output, time::Duration};

const TLS_MESSAGE: &str =
    "Не удалось установить защищённое соединение с платформой. Проверьте подключение и попробуйте ещё раз.";

fn tls_session_error(log: &str) -> bool {
    log.lines().any(|line| {
        let line = line.to_ascii_lowercase();
        line.contains("[ssl: invalid_session_id]")
            || (line.contains("sslerror") && line.contains("invalid session id"))
    })
}

pub(super) async fn capture(
    app: &tauri::AppHandle,
    url: &str,
    timeout: Duration,
    timeout_message: &str,
    configure: impl Fn(&mut Command),
) -> Result<Output, String> {
    let (mut cmd, _session) = ytdlp(app, url)?;
    configure(&mut cmd);
    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| timeout_message.to_owned())?
        .map_err(|e| format!("Не удалось запустить yt-dlp: {e}"))?;
    if !output.status.success() {
        return Err(error_message(&output.stderr, url));
    }
    Ok(output)
}

pub(super) fn connection_message(stderr: &str) -> Option<&'static str> {
    tls_session_error(stderr).then_some(TLS_MESSAGE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_tls_session_error_without_confusing_it_with_login() {
        let tls = "ERROR: [youtube] Unable to download API page: [SSL: INVALID_SESSION_ID] invalid session id (_ssl.c:1085)";
        assert_eq!(
            error_message(
                tls.as_bytes(),
                "https://www.youtube.com/watch?v=jNQXAC9IVRw"
            ),
            TLS_MESSAGE
        );
        assert!(connection_message("ERROR: certificate verify failed").is_none());
        assert!(connection_message("ERROR: sign in to confirm").is_none());
    }
}
