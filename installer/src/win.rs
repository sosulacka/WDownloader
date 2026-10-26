//! Ярлыки, папки Windows и запись в "Установленные приложения" (HKCU).

use std::path::{Path, PathBuf};
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHChangeNotify, SHGetKnownFolderPath, ShellLink, FOLDERID_Desktop, FOLDERID_Programs,
    KF_FLAG_DEFAULT, SHCNE_UPDATEITEM, SHCNF_PATHW,
};

const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Wdownloader";
pub const LINK_NAME: &str = "Wdownloader.lnk";

fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
    unsafe {
        let raw = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const _));
        path
    }
}

pub fn start_menu() -> Option<PathBuf> {
    known_folder(&FOLDERID_Programs)
}

pub fn desktop() -> Option<PathBuf> {
    known_folder(&FOLDERID_Desktop)
}

pub fn create_shortcut(link: &Path, target: &Path) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let shell: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        let target_h = HSTRING::from(target);
        shell.SetPath(&target_h).map_err(|e| e.to_string())?;
        if let Some(dir) = target.parent() {
            shell
                .SetWorkingDirectory(&HSTRING::from(dir))
                .map_err(|e| e.to_string())?;
        }
        shell
            .SetDescription(&HSTRING::from("Видео и аудио с YouTube"))
            .map_err(|e| e.to_string())?;
        shell
            .SetIconLocation(&target_h, 0)
            .map_err(|e| e.to_string())?;
        let file: IPersistFile = shell.cast().map_err(|e| e.to_string())?;
        file.Save(&HSTRING::from(link), true)
            .map_err(|e| e.to_string())?;
    }
    refresh_icon(link);
    Ok(())
}

pub fn refresh_icon(path: &Path) {
    let path = HSTRING::from(path);
    unsafe {
        SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(path.as_ptr().cast()), None);
    }
}

fn wide(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

pub struct UninstallEntry<'a> {
    pub dir: &'a Path,
    pub version: &'a str,
    pub size_kb: u32,
}

pub fn register(entry: &UninstallEntry) -> Result<(), String> {
    unsafe {
        let mut key = HKEY::default();
        let status = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(UNINSTALL_KEY),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut key,
            None,
        );
        if status.0 != 0 {
            return Err(format!("Не удалось записать данные в реестр (код {})", status.0));
        }
        let dir = entry.dir.display().to_string();
        let exe = entry.dir.join("Wdownloader.exe").display().to_string();
        let uninstall = entry.dir.join("uninstall.exe").display().to_string();
        let strings = [
            ("DisplayName", "Wdownloader".to_string()),
            ("DisplayVersion", entry.version.to_string()),
            ("Publisher", "WTEAM".to_string()),
            ("URLInfoAbout", "https://wteam.su".to_string()),
            ("DisplayIcon", exe),
            ("InstallLocation", dir),
            ("UninstallString", format!("\"{uninstall}\" --uninstall")),
        ];
        for (name, value) in strings {
            let _ = RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(&wide(&value)));
        }
        for (name, value) in [("NoModify", 1u32), ("NoRepair", 1), ("EstimatedSize", entry.size_kb)] {
            let _ = RegSetValueExW(
                key,
                &HSTRING::from(name),
                None,
                REG_DWORD,
                Some(&value.to_le_bytes()),
            );
        }
        let _ = RegCloseKey(key);
    }
    Ok(())
}

pub fn unregister() {
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(UNINSTALL_KEY));
    }
}

/// Папка прошлой установки, если приложение уже стоит.
pub fn installed_dir() -> Option<PathBuf> {
    unsafe {
        let mut buffer = vec![0u16; 1024];
        let mut bytes = (buffer.len() * 2) as u32;
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(UNINSTALL_KEY),
            &HSTRING::from("InstallLocation"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut bytes),
        );
        if status.0 != 0 {
            return None;
        }
        let len = buffer.iter().position(|c| *c == 0).unwrap_or(0);
        let path = PathBuf::from(String::from_utf16_lossy(&buffer[..len]));
        (!path.as_os_str().is_empty()).then_some(path)
    }
}
