//! Собирает setup.exe: stub + zip с приложением (+ tools для офлайн-версии).
//! pack --setup <stub.exe> --app <Wdownloader.exe> --license <file> --notice <file> --licenses <dir> [--tools <dir>] --out <file>

use std::fs::File;
use std::io::{self, Seek, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

#[path = "payload.rs"]
#[allow(dead_code)]
mod payload;

fn arg(name: &str) -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
}

fn collect_licenses(root: &Path, dir: &Path, files: &mut Vec<(String, PathBuf)>) -> io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_licenses(root, &path, files)?;
        } else if entry.file_type()?.is_file() {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            files.push((format!("licenses/{relative}"), path));
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let setup = arg("--setup").expect("--setup <stub.exe>");
    let app = arg("--app").expect("--app <Wdownloader.exe>");
    let out = arg("--out").expect("--out <file>");
    let tools = arg("--tools");
    let license = arg("--license").expect("--license <file>");
    let notice = arg("--notice").expect("--notice <file>");
    let licenses = arg("--licenses").expect("--licenses <dir>");

    let mut files = vec![
        ("Wdownloader.exe".to_string(), app),
        ("LICENSE".to_string(), license),
        ("NOTICE".to_string(), notice),
    ];
    collect_licenses(&licenses, &licenses, &mut files)?;
    if let Some(dir) = tools {
        let mut entries: Vec<_> = std::fs::read_dir(&dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_file() && p.file_name().is_some_and(|n| n != ".gitkeep"))
            .collect();
        entries.sort();
        for path in entries {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            files.push((format!("tools/{name}"), path));
        }
    }

    // Zip пишется отдельно, чтобы смещения внутри него считались от нуля.
    let temp = out.with_extension("zip.tmp");
    {
        let mut zip = zip::ZipWriter::new(File::create(&temp)?);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        for (name, path) in &files {
            println!("  + {name}");
            zip.start_file(name.as_str(), options)?;
            io::copy(&mut File::open(path)?, &mut zip)?;
        }
        zip.finish()?;
    }

    let mut output = File::create(&out)?;
    io::copy(&mut File::open(&setup)?, &mut output)?;
    let stub_len = output.stream_position()?;
    io::copy(&mut File::open(&temp)?, &mut output)?;
    output.write_all(&stub_len.to_le_bytes())?;
    output.write_all(payload::MAGIC)?;
    output.sync_all()?;
    std::fs::remove_file(&temp)?;
    println!(
        "  = {} ({:.1} МБ)",
        out.display(),
        output.metadata()?.len() as f64 / 1048576.0
    );
    Ok(())
}
