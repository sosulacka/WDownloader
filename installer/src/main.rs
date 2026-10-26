#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod payload;
mod win;

use payload::Payload;
use serde::Serialize;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const NO_WINDOW: u32 = 0x0800_0000;
const APP_ID: &str = "com.wdownloader.desktop";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    mode: &'static str,
    version: &'static str,
    dir: String,
    installed: bool,
    offline: bool,
    size: u64,
    ready: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    file: String,
    progress: f64,
}

fn uninstall_mode() -> bool {
    std::env::args().any(|a| a == "--uninstall")
        || std::env::current_exe()
            .ok()
            .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()))
            .is_some_and(|s| s.contains("uninstall"))
}

fn local_appdata() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

fn default_dir() -> PathBuf {
    win::installed_dir().unwrap_or_else(|| local_appdata().join("Programs").join("Wdownloader"))
}

/// Закрывает запущенное приложение, иначе файлы заняты.
fn stop_app() {
    let _ = Command::new("taskkill")
        .args(["/IM", "Wdownloader.exe", "/F"])
        .creation_flags(NO_WINDOW)
        .status();
}

fn emit(app: &tauri::AppHandle, stage: &'static str, file: &str, progress: f64) {
    let _ = app.emit(
        "progress",
        Progress {
            stage,
            file: file.into(),
            progress: progress.clamp(0.0, 100.0),
        },
    );
}

#[tauri::command]
fn info() -> Info {
    let exe = std::env::current_exe().unwrap_or_default();
    let mut payload = Payload::open(&exe);
    let installed = win::installed_dir().is_some_and(|d| d.join("Wdownloader.exe").is_file());
    Info {
        mode: if uninstall_mode() { "uninstall" } else { "install" },
        version: VERSION,
        dir: if uninstall_mode() {
            exe.parent().unwrap_or(Path::new("")).display().to_string()
        } else {
            default_dir().display().to_string()
        },
        installed,
        offline: payload.as_ref().is_some_and(Payload::offline),
        size: payload.as_mut().map(Payload::total_size).unwrap_or(0),
        ready: payload.is_some() || uninstall_mode(),
    }
}

#[tauri::command]
async fn pick_dir(app: tauri::AppHandle, current: String) -> Option<String> {
    let start = PathBuf::from(&current);
    let parent = start.parent().filter(|p| p.is_dir()).unwrap_or(&start);
    let picked = app
        .dialog()
        .file()
        .set_title("Папка установки")
        .set_directory(parent)
        .blocking_pick_folder()?
        .into_path()
        .ok()?;
    // Как у обычных установщиков: выбрали C:\Apps, ставим в C:\Apps\Wdownloader.
    let picked = if picked.ends_with("Wdownloader") {
        picked
    } else {
        picked.join("Wdownloader")
    };
    Some(picked.display().to_string())
}

fn copy_entry(
    app: &tauri::AppHandle,
    entry: &mut impl Read,
    out: &Path,
    name: &str,
    done: &mut u64,
    total: u64,
) -> io::Result<()> {
    let temp = out.with_extension("wdpart");
    let mut file = File::create(&temp)?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = entry.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        *done += n as u64;
        emit(app, "copy", name, *done as f64 / total.max(1) as f64 * 92.0);
    }
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temp, out)
}

fn run_install(app: &tauri::AppHandle, dir: &Path, desktop: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut payload = Payload::open(&exe).ok_or("Установщик повреждён: нет файлов приложения.")?;
    emit(app, "prepare", "", 0.0);
    stop_app();
    std::fs::create_dir_all(dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;

    let total = payload.total_size();
    let mut done = 0u64;
    for i in 0..payload.zip.len() {
        let mut entry = payload.zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let out = dir.join(&relative);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let name = relative.display().to_string();
        copy_entry(app, &mut entry, &out, &name, &mut done, total)
            .map_err(|e| format!("Не удалось записать {name}: {e}"))?;
    }

    // uninstall.exe: тот же stub без пакета.
    emit(app, "finish", "uninstall.exe", 94.0);
    let mut source = File::open(&exe).map_err(|e| e.to_string())?;
    let mut stub = File::create(dir.join("uninstall.exe")).map_err(|e| e.to_string())?;
    io::copy(&mut (&mut source).take(payload.stub_len), &mut stub).map_err(|e| e.to_string())?;

    emit(app, "finish", "Ярлыки", 97.0);
    let target = dir.join("Wdownloader.exe");
    if let Some(menu) = win::start_menu() {
        win::create_shortcut(&menu.join(win::LINK_NAME), &target)?;
    }
    if let Some(desk) = win::desktop() {
        let link = desk.join(win::LINK_NAME);
        if desktop {
            win::create_shortcut(&link, &target)?;
        } else {
            let _ = std::fs::remove_file(link);
        }
    }
    win::register(&win::UninstallEntry {
        dir,
        version: VERSION,
        size_kb: (total / 1024).min(u32::MAX as u64) as u32,
    })?;
    emit(app, "done", "", 100.0);
    Ok(())
}

#[tauri::command]
async fn install(app: tauri::AppHandle, dir: String, desktop: bool) -> Result<(), String> {
    let dir = PathBuf::from(dir.trim());
    if !dir.is_absolute() {
        return Err("Укажите полный путь к папке установки.".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_install(&app, &dir, desktop))
        .await
        .map_err(|e| e.to_string())?
}

fn run_uninstall(app: &tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Не удалось определить папку")?.to_path_buf();
    if !dir.join("Wdownloader.exe").is_file() {
        return Err("В этой папке нет Wdownloader.".into());
    }
    emit(app, "prepare", "", 5.0);
    stop_app();
    let entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p != &exe)
        .collect();
    for (i, path) in entries.iter().enumerate() {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        emit(app, "remove", &name, 10.0 + i as f64 / entries.len().max(1) as f64 * 70.0);
        let result = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        result.map_err(|e| format!("Не удалось удалить {name}: {e}"))?;
    }
    emit(app, "remove", "Ярлыки", 85.0);
    for folder in [win::start_menu(), win::desktop()].into_iter().flatten() {
        let _ = std::fs::remove_file(folder.join(win::LINK_NAME));
    }
    win::unregister();
    if remove_data {
        emit(app, "remove", "Данные приложения", 92.0);
        let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
        for base in [Some(local_appdata()), roaming].into_iter().flatten() {
            let _ = std::fs::remove_dir_all(base.join(APP_ID));
        }
    }
    emit(app, "done", "", 100.0);
    Ok(())
}

#[tauri::command]
async fn uninstall(app: tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_uninstall(&app, remove_data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch(dir: String) -> Result<(), String> {
    Command::new(PathBuf::from(dir).join("Wdownloader.exe"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Закрывает окно. После удаления uninstall.exe и папка стираются через cmd,
/// потому что запущенный exe не может удалить сам себя.
#[tauri::command]
fn quit(app: tauri::AppHandle, cleanup: bool) {
    if cleanup {
        if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
            let script = format!(
                "ping -n 3 127.0.0.1 >nul & rmdir /s /q \"{}\"",
                dir.display()
            );
            let _ = Command::new("cmd")
                .args(["/C", &script])
                .creation_flags(NO_WINDOW)
                .spawn();
        }
    }
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            info, pick_dir, install, uninstall, launch, quit
        ])
        .setup(|app| {
            // Данные WebView во временной папке: установщик ничего не оставляет у пользователя.
            let data = std::env::temp_dir().join("wdownloader-setup");
            let title = if uninstall_mode() {
                "Удаление Wdownloader"
            } else {
                "Установка Wdownloader"
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(760.0, 500.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .shadow(true)
                .center()
                .background_color(tauri::window::Color(9, 9, 10, 255))
                .data_directory(data)
                .build()?;
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Не удалось запустить установщик");
}
