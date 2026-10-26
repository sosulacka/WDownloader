//! Локальный HTTP CONNECT прокси для yt-dlp.
//!
//! Решает сетевые проблемы, из-за которых YouTube не открывается в приложении,
//! хотя в браузере работает:
//! - системный DNS не находит адрес (getaddrinfo 11001): адрес берётся через
//!   DNS-over-HTTPS по IP (Cloudflare, Google), как делает браузер;
//! - провайдер рвёт соединение по имени сайта (10054): первое TLS-сообщение
//!   режется на два TCP-сегмента, имя сайта оказывается разорвано;
//! - сломанный IPv6 тормозит подключение: адреса пробуются по очереди, IPv4 первым,
//!   у каждой попытки короткий таймаут.

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

static PROXY: OnceLock<String> = OnceLock::new();
static DNS: OnceLock<Mutex<HashMap<String, (Vec<IpAddr>, Instant)>>> = OnceLock::new();

const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const DNS_TTL: Duration = Duration::from_secs(600);
const DOH: [(&str, &str); 3] = [
    ("1.1.1.1", "cloudflare-dns.com"),
    ("8.8.8.8", "dns.google"),
    ("1.0.0.1", "cloudflare-dns.com"),
];

/// Адрес прокси для `--proxy`. None, если запустить не удалось: тогда yt-dlp идёт напрямую.
pub fn proxy() -> Option<&'static str> {
    PROXY.get().map(String::as_str)
}

/// Запускает прокси на 127.0.0.1 со случайным портом. Слушает только локально.
pub fn start() {
    tauri::async_runtime::spawn(async {
        let Ok(listener) = TcpListener::bind("127.0.0.1:0").await else {
            return;
        };
        let Ok(addr) = listener.local_addr() else {
            return;
        };
        let _ = PROXY.set(format!("http://{addr}"));
        loop {
            let Ok((client, peer)) = listener.accept().await else {
                continue;
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            tokio::spawn(async move {
                let _ = tunnel(client).await;
            });
        }
    });
}

/// Хосты, которые пускаем через прокси. Остальное (GitHub и т.п.) не нужно yt-dlp для YouTube,
/// но и не запрещено: ограничение только на порты.
fn allowed_port(port: u16) -> bool {
    port == 443 || port == 80
}

async fn tunnel(mut client: TcpStream) -> std::io::Result<()> {
    client.set_nodelay(true)?;
    // Читаем заголовок CONNECT целиком (до пустой строки).
    let mut head = Vec::with_capacity(512);
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = tokio::time::timeout(Duration::from_secs(10), client.read(&mut buf)).await??;
        if n == 0 || head.len() > 8192 {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
    }
    let text = String::from_utf8_lossy(&head);
    let mut parts = text.split_whitespace();
    let (Some("CONNECT"), Some(target)) = (parts.next(), parts.next()) else {
        client
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n")
            .await?;
        return Ok(());
    };
    let Some((host, port)) = target.rsplit_once(':') else {
        return Ok(());
    };
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    let Ok(port) = port.parse::<u16>() else {
        return Ok(());
    };
    if !allowed_port(port) {
        client
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            .await?;
        return Ok(());
    }

    let Some(mut server) = connect(&host, port).await else {
        client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
            .await?;
        return Ok(());
    };
    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    // Первый пакет клиента (TLS ClientHello) отправляем двумя сегментами,
    // чтобы имя сайта не попало в один кусок целиком.
    let mut first = vec![0u8; 16 * 1024];
    let n = tokio::time::timeout(Duration::from_secs(15), client.read(&mut first)).await??;
    if n == 0 {
        return Ok(());
    }
    let first = &first[..n];
    if port == 443 && n > 8 && first[0] == 0x16 {
        let cut = sni_split(first).unwrap_or(2);
        server.write_all(&first[..cut]).await?;
        server.flush().await?;
        tokio::time::sleep(Duration::from_millis(5)).await;
        server.write_all(&first[cut..]).await?;
    } else {
        server.write_all(first).await?;
    }

    tokio::io::copy_bidirectional(&mut client, &mut server).await?;
    Ok(())
}

/// Позиция внутри имени сервера в ClientHello. Если не нашли, режем после 2 байт.
fn sni_split(hello: &[u8]) -> Option<usize> {
    // Ищем расширение server_name (0x0000) по сигнатуре: тип 00 00, затем длины, тип имени 00.
    for i in 5..hello.len().saturating_sub(9) {
        if hello[i] == 0x00 && hello[i + 1] == 0x00 && hello[i + 6] == 0x00 {
            let name_len = u16::from_be_bytes([hello[i + 7], hello[i + 8]]) as usize;
            let start = i + 9;
            if name_len >= 4 && start + name_len <= hello.len() {
                let name = &hello[start..start + name_len];
                if name.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'.' || *c == b'-') {
                    return Some(start + name_len / 2);
                }
            }
        }
    }
    None
}

async fn connect(host: &str, port: u16) -> Option<TcpStream> {
    let mut addrs = resolve(host).await;
    // IPv4 первым: у многих пользователей IPv6 настроен, но не работает.
    addrs.sort_by_key(|ip| ip.is_ipv6());
    for ip in addrs.into_iter().take(6) {
        let attempt = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(SocketAddr::new(ip, port)));
        if let Ok(Ok(stream)) = attempt.await {
            let _ = stream.set_nodelay(true);
            return Some(stream);
        }
    }
    None
}

async fn resolve(host: &str) -> Vec<IpAddr> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return vec![ip];
    }
    let cache = DNS.get_or_init(Default::default);
    if let Some((ips, at)) = cache.lock().unwrap().get(host) {
        if at.elapsed() < DNS_TTL {
            return ips.clone();
        }
    }
    // Сначала системный DNS, параллельно DoH. Берём первый непустой ответ.
    let system = async {
        tokio::time::timeout(
            Duration::from_secs(4),
            tokio::net::lookup_host((host, 443)),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
        .unwrap_or_default()
    };
    let doh = doh_lookup(host);
    tokio::pin!(system, doh);
    let mut ips = tokio::select! {
        ips = &mut system => if ips.is_empty() { doh.await } else { ips },
        ips = &mut doh => if ips.is_empty() { system.await } else { ips },
    };
    ips.dedup();
    if !ips.is_empty() {
        cache
            .lock()
            .unwrap()
            .insert(host.to_string(), (ips.clone(), Instant::now()));
    }
    ips
}

fn doh_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .no_proxy();
            // DoH-серверы по IP: системный DNS для них не нужен.
            for (ip, name) in DOH {
                if let Ok(ip) = ip.parse::<IpAddr>() {
                    builder = builder.resolve(name, SocketAddr::new(ip, 443));
                }
            }
            builder.build().ok()
        })
        .as_ref()
}

async fn doh_lookup(host: &str) -> Vec<IpAddr> {
    let Some(client) = doh_client() else {
        return Vec::new();
    };
    for (_, name) in DOH {
        let path = if name == "dns.google" { "resolve" } else { "dns-query" };
        let mut ips = Vec::new();
        for kind in ["A", "AAAA"] {
            let url = format!("https://{name}/{path}?name={host}&type={kind}");
            let Ok(response) = client
                .get(&url)
                .header("accept", "application/dns-json")
                .send()
                .await
            else {
                continue;
            };
            let Some(json) = response.bytes().await.ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) else {
                continue;
            };
            for answer in json["Answer"].as_array().into_iter().flatten() {
                if let Some(ip) = answer["data"].as_str().and_then(|d| d.parse::<IpAddr>().ok()) {
                    ips.push(ip);
                }
            }
            if !ips.is_empty() && kind == "A" {
                break;
            }
        }
        if !ips.is_empty() {
            return ips;
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_inside_server_name() {
        let name = b"www.youtube.com";
        let mut hello = vec![0x16, 0x03, 0x01, 0x00, 0x60, 0x01, 0, 0, 0x5c, 0x03, 0x03];
        hello.extend_from_slice(&[0x00, 0x00, 0x00, 0x14, 0x00, 0x12, 0x00, 0x00, 0x0f]);
        let start = hello.len();
        hello.extend_from_slice(name);
        hello.extend_from_slice(&[0u8; 20]);
        let cut = sni_split(&hello).unwrap();
        assert!(cut > start && cut < start + name.len());
    }
}
