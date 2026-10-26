//! Пакет с файлами приложения дописан в конец setup.exe:
//! [stub exe][zip][u64 LE: длина stub][MAGIC].

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

pub const MAGIC: &[u8; 8] = b"WDSETUP\0";
pub const TRAILER: u64 = 16;

/// Окно файла [start, start + len), которое zip видит как отдельный файл.
pub struct Slice {
    file: File,
    start: u64,
    len: u64,
    pos: u64,
}

impl Read for Slice {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.len.saturating_sub(self.pos);
        if left == 0 {
            return Ok(0);
        }
        let n = buf.len().min(left as usize);
        let read = self.file.read(&mut buf[..n])?;
        self.pos += read as u64;
        Ok(read)
    }
}

impl Seek for Slice {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let next = match to {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(n) => self.len as i64 + n,
            SeekFrom::Current(n) => self.pos as i64 + n,
        };
        if next < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start"));
        }
        self.pos = next as u64;
        self.file.seek(SeekFrom::Start(self.start + self.pos))?;
        Ok(self.pos)
    }
}

pub struct Payload {
    /// Размер setup.exe без пакета. Из этих байт получается uninstall.exe.
    pub stub_len: u64,
    pub zip: zip::ZipArchive<Slice>,
}

impl Payload {
    pub fn open(exe: &Path) -> Option<Payload> {
        let mut file = File::open(exe).ok()?;
        let size = file.metadata().ok()?.len();
        if size < TRAILER {
            return None;
        }
        file.seek(SeekFrom::Start(size - TRAILER)).ok()?;
        let mut trailer = [0u8; 16];
        file.read_exact(&mut trailer).ok()?;
        if &trailer[8..] != MAGIC {
            return None;
        }
        let stub_len = u64::from_le_bytes(trailer[..8].try_into().ok()?);
        if stub_len >= size - TRAILER {
            return None;
        }
        file.seek(SeekFrom::Start(stub_len)).ok()?;
        let slice = Slice {
            file,
            start: stub_len,
            len: size - TRAILER - stub_len,
            pos: 0,
        };
        let zip = zip::ZipArchive::new(slice).ok()?;
        Some(Payload { stub_len, zip })
    }

    pub fn total_size(&mut self) -> u64 {
        (0..self.zip.len())
            .filter_map(|i| self.zip.by_index(i).ok().map(|e| e.size()))
            .sum()
    }

    pub fn offline(&self) -> bool {
        self.zip.file_names().any(|n| n.starts_with("tools/"))
    }
}
