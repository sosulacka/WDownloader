$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot 'tools'
$cacheDirectory = Join-Path $projectRoot '.tools-cache'
New-Item -ItemType Directory -Force -Path $toolsDirectory, $cacheDirectory | Out-Null

function Get-Download([string]$Url, [string]$Destination) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

# Всё кладём рядом с проектом, PATH не трогаем.
Get-Download 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' (Join-Path $cacheDirectory 'yt-dlp.exe')
Get-Download 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS' (Join-Path $cacheDirectory 'yt-dlp-checksums.txt')
$checksumLine = Get-Content (Join-Path $cacheDirectory 'yt-dlp-checksums.txt') | Where-Object { $_ -match '\s+yt-dlp\.exe$' } | Select-Object -First 1
if (-not $checksumLine) { throw 'yt-dlp checksum was not found.' }
$expectedHash = ($checksumLine -split '\s+')[0]
$hashProvider = [System.Security.Cryptography.SHA256]::Create()
$hashStream = [System.IO.File]::OpenRead((Join-Path $cacheDirectory 'yt-dlp.exe'))
try { $actualHash = [BitConverter]::ToString($hashProvider.ComputeHash($hashStream)).Replace('-', '') }
finally { $hashStream.Dispose(); $hashProvider.Dispose() }
if ($actualHash -ne $expectedHash) { throw 'yt-dlp SHA256 verification failed.' }
Copy-Item -LiteralPath (Join-Path $cacheDirectory 'yt-dlp.exe') -Destination $toolsDirectory -Force

$ffmpegArchive = Join-Path $cacheDirectory 'ffmpeg.zip'
Get-Download 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' $ffmpegArchive
$ffmpegExpanded = Join-Path $cacheDirectory ('ffmpeg-' + [guid]::NewGuid().ToString('N'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($ffmpegArchive, $ffmpegExpanded)
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
    $binary = Get-ChildItem -LiteralPath $ffmpegExpanded -Recurse -File -Filter $name | Select-Object -First 1
    if (-not $binary) { throw "$name was not found in the archive." }
    Copy-Item -LiteralPath $binary.FullName -Destination $toolsDirectory -Force
}
$ffmpegLicense = Get-ChildItem -LiteralPath $ffmpegExpanded -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' } | Select-Object -First 1
if ($ffmpegLicense) { Copy-Item -LiteralPath $ffmpegLicense.FullName -Destination (Join-Path $toolsDirectory 'FFmpeg-LICENSE.txt') -Force }

$denoArchive = Join-Path $cacheDirectory 'deno.zip'
Get-Download 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' $denoArchive
$denoExpanded = Join-Path $cacheDirectory ('deno-' + [guid]::NewGuid().ToString('N'))
[System.IO.Compression.ZipFile]::ExtractToDirectory($denoArchive, $denoExpanded)
Copy-Item -LiteralPath (Join-Path $denoExpanded 'deno.exe') -Destination $toolsDirectory -Force

@'
Bundled tools and source code:
yt-dlp: https://github.com/yt-dlp/yt-dlp (Unlicense; bundled executable includes third-party components)
FFmpeg: https://github.com/yt-dlp/FFmpeg-Builds (GPL build)
FFmpeg corresponding build sources and scripts: https://github.com/yt-dlp/FFmpeg-Builds
Deno: https://github.com/denoland/deno (MIT)
Review each tool's redistribution terms before distributing a commercial installer.
'@ | Set-Content -LiteralPath (Join-Path $toolsDirectory 'THIRD-PARTY.txt') -Encoding UTF8

& (Join-Path $toolsDirectory 'yt-dlp.exe') --version
& (Join-Path $toolsDirectory 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $toolsDirectory 'deno.exe') --version | Select-Object -First 1
Write-Host 'Ready. Start the app with: npm run desktop'
