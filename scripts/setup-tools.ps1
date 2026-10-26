$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot 'tools'
$cacheDirectory = Join-Path $projectRoot '.tools-cache'
New-Item -ItemType Directory -Force -Path $toolsDirectory, $cacheDirectory | Out-Null

function Get-Download([string]$Url, [string]$Destination) {
    Write-Host "Downloading $Url"
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 600
            return
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds 2
        }
    }
}

function Get-Asset($Release, [string]$Name) {
    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $asset) { throw "Release asset was not found: $Name" }
    return $asset.browser_download_url
}

function Get-Sha256([string]$File) {
    $provider = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($provider.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $provider.Dispose() }
}

function Get-VerifiedDownload([string]$Url, [string]$Destination, [string]$ExpectedHash) {
    if ($ExpectedHash -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid SHA256 for $Url" }
    if ((Test-Path -LiteralPath $Destination) -and (Get-Sha256 $Destination) -eq $ExpectedHash) {
        Write-Host "Using verified cache: $Destination"
        return
    }
    Get-Download $Url $Destination
    if ((Get-Sha256 $Destination) -ne $ExpectedHash) {
        throw "SHA256 verification failed: $Url"
    }
}

function Get-ExpectedHash([string]$File, [string]$Name) {
    $pattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($Name) + '$'
    foreach ($line in Get-Content -LiteralPath $File) {
        if ($line -match $pattern) { return $Matches[1] }
    }
    # У Deno для Windows контрольная сумма в формате PowerShell.
    $text = Get-Content -LiteralPath $File -Raw
    $pathPattern = '(?m)^Path\s*:\s*.*[\\/]' + [regex]::Escape($Name) + '\s*$'
    if ($text -match '(?m)^Algorithm\s*:\s*SHA256\s*$' -and $text -match $pathPattern -and $text -match '(?m)^Hash\s*:\s*([0-9a-fA-F]{64})\s*$') {
        return $Matches[1]
    }
    throw "Checksum was not found: $Name"
}

# Всё кладём рядом с проектом, PATH не трогаем.
$headers = @{ 'User-Agent' = 'Wdownloader-build' }
$ytdlp = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers $headers
$ffmpeg = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest' -Headers $headers
$deno = Invoke-RestMethod 'https://api.github.com/repos/denoland/deno/releases/latest' -Headers $headers

$ytdlpChecksums = Join-Path $cacheDirectory 'yt-dlp-checksums.txt'
Get-Download (Get-Asset $ytdlp 'SHA2-256SUMS') $ytdlpChecksums
Get-VerifiedDownload (Get-Asset $ytdlp 'yt-dlp.exe') (Join-Path $cacheDirectory 'yt-dlp.exe') (Get-ExpectedHash $ytdlpChecksums 'yt-dlp.exe')
Copy-Item -LiteralPath (Join-Path $cacheDirectory 'yt-dlp.exe') -Destination $toolsDirectory -Force

$ffmpegArchive = Join-Path $cacheDirectory 'ffmpeg.zip'
$ffmpegChecksums = Join-Path $cacheDirectory 'ffmpeg-checksums.txt'
$ffmpegName = 'ffmpeg-master-latest-win64-gpl.zip'
Get-Download (Get-Asset $ffmpeg 'checksums.sha256') $ffmpegChecksums
Get-VerifiedDownload (Get-Asset $ffmpeg $ffmpegName) $ffmpegArchive (Get-ExpectedHash $ffmpegChecksums $ffmpegName)
$ffmpegExpanded = Join-Path $cacheDirectory ('ffmpeg-' + [guid]::NewGuid().ToString('N'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($ffmpegArchive, $ffmpegExpanded)
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
    $binary = Get-ChildItem -LiteralPath $ffmpegExpanded -Recurse -File -Filter $name | Select-Object -First 1
    if (-not $binary) { throw "$name was not found in the archive." }
    Copy-Item -LiteralPath $binary.FullName -Destination $toolsDirectory -Force
}
$ffmpegLicense = Get-ChildItem -LiteralPath $ffmpegExpanded -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' } | Select-Object -First 1
if (-not $ffmpegLicense) { throw 'FFmpeg license was not found in the archive.' }
Copy-Item -LiteralPath $ffmpegLicense.FullName -Destination (Join-Path $toolsDirectory 'FFmpeg-LICENSE.txt') -Force

$denoArchive = Join-Path $cacheDirectory 'deno.zip'
$denoChecksums = Join-Path $cacheDirectory 'deno-checksums.txt'
$denoName = 'deno-x86_64-pc-windows-msvc.zip'
Get-Download (Get-Asset $deno "$denoName.sha256sum") $denoChecksums
Get-VerifiedDownload (Get-Asset $deno $denoName) $denoArchive (Get-ExpectedHash $denoChecksums $denoName)
$denoExpanded = Join-Path $cacheDirectory ('deno-' + [guid]::NewGuid().ToString('N'))
[System.IO.Compression.ZipFile]::ExtractToDirectory($denoArchive, $denoExpanded)
Copy-Item -LiteralPath (Join-Path $denoExpanded 'deno.exe') -Destination $toolsDirectory -Force

Get-Download "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$($ytdlp.tag_name)/LICENSE" (Join-Path $toolsDirectory 'yt-dlp-LICENSE.txt')
Get-Download "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$($ytdlp.tag_name)/THIRD_PARTY_LICENSES.txt" (Join-Path $toolsDirectory 'yt-dlp-THIRD-PARTY.txt')
Get-Download "https://raw.githubusercontent.com/denoland/deno/$($deno.tag_name)/LICENSE.md" (Join-Path $toolsDirectory 'Deno-LICENSE.txt')

$versions = [ordered]@{}
foreach ($name in @('yt-dlp', 'ffmpeg', 'ffprobe', 'deno')) {
    $flag = if ($name -in @('ffmpeg', 'ffprobe')) { '-version' } else { '--version' }
    $output = & (Join-Path $toolsDirectory "$name.exe") $flag
    if ($LASTEXITCODE -ne 0) { throw "$name failed to start." }
    $versions[$name] = $output | Select-Object -First 1
    Write-Host $versions[$name]
}
$ffmpegCommit = [regex]::Match($versions.ffmpeg, '-g([0-9a-f]{7,40})').Groups[1].Value
@"
Bundled tools and source code:
yt-dlp $($ytdlp.tag_name): $($ytdlp.html_url)
Source: https://github.com/yt-dlp/yt-dlp/tree/$($ytdlp.tag_name)
License: Unlicense; bundled executable notices: yt-dlp-THIRD-PARTY.txt

$($versions.ffmpeg)
Source: https://github.com/FFmpeg/FFmpeg/tree/$ffmpegCommit
Build scripts and dependencies: https://github.com/yt-dlp/FFmpeg-Builds
Build configuration: FFMPEG-BUILD.txt
License: GPL v3, see FFmpeg-LICENSE.txt

Deno $($deno.tag_name): $($deno.html_url)
Source: https://github.com/denoland/deno/tree/$($deno.tag_name)
License: MIT, see Deno-LICENSE.txt
"@ | Set-Content -LiteralPath (Join-Path $toolsDirectory 'THIRD-PARTY.txt') -Encoding UTF8
& (Join-Path $toolsDirectory 'ffmpeg.exe') -version | Set-Content -LiteralPath (Join-Path $toolsDirectory 'FFMPEG-BUILD.txt') -Encoding UTF8
$manifest = [ordered]@{ versions = $versions; files = @() }
foreach ($name in @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'deno.exe')) {
    $manifest.files += @{ name = $name; sha256 = Get-Sha256 (Join-Path $toolsDirectory $name) }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $toolsDirectory 'versions.json') -Encoding UTF8
Write-Host 'Ready. Start the app with: npm run desktop'
