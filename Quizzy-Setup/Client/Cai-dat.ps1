param(
  [string]$Url,
  [string]$ShortcutDir  # chỉ dùng khi thử nghiệm; mặc định là Desktop và Start Menu
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Url) { $Url = (Get-Content (Join-Path $here 'config.json') -Raw | ConvertFrom-Json).url }
if ($Url -notmatch '^https?://' -or $Url -match 'DIEN-DIA-CHI') {
  throw 'Chưa điền địa chỉ máy chủ trong file config.json (dòng "url").'
}

# Quizzy chạy trong cửa sổ app của Chrome hoặc Edge (cần để chọn thư mục đồng bộ)
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { throw 'Không tìm thấy Chrome hoặc Edge. Hãy cài Chrome rồi chạy lại.' }

$installDir = Join-Path $env:LOCALAPPDATA 'Quizzy'
New-Item -ItemType Directory -Force $installDir | Out-Null
Copy-Item (Join-Path $here 'quizzy.ico') $installDir -Force

$dirs = if ($ShortcutDir) { @($ShortcutDir) } else {
  @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Quizzy'))
}
$shell = New-Object -ComObject WScript.Shell
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force $d | Out-Null
  $lnk = $shell.CreateShortcut((Join-Path $d 'Quizzy.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = "--app=$Url"
  $lnk.IconLocation = (Join-Path $installDir 'quizzy.ico') + ',0'
  $lnk.Description = 'Quizzy - học từ vựng và tài liệu'
  $lnk.Save()
}
Write-Host "Đã cài Quizzy. Mở shortcut 'Quizzy' trên Desktop. Địa chỉ: $Url"
