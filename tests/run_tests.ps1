# Хэлмэрчийн бүх тест — шинэ хувилбар гаргахаас өмнө ажиллуулна:
#   powershell -ExecutionPolicy Bypass -File tests\run_tests.ps1
# 1) JS синтакс  2) Python синтакс  3) серверийн тест  4) өргөтгөлийн тест (Chrome headless)
param(
  [string]$Python = "$env:LOCALAPPDATA\Helmerch\python\python.exe",
  [string]$Chrome = ""
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$fail = 0
function Ok($m) { Write-Host "  OK    $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }

Write-Host "1) JS синтакс"
Get-ChildItem "$root\extension\*.js" | ForEach-Object {
  node --check $_.FullName 2>$null; if ($LASTEXITCODE -eq 0) { Ok $_.Name } else { Bad $_.Name }
}

Write-Host "2) Python синтакс"
if (-not (Test-Path $Python)) { $Python = (Get-Command python -ErrorAction SilentlyContinue).Source }
foreach ($f in "hadmal_server.py", "hadmal_app.pyw", "logo.py") {
  & $Python -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$root\server\$f" 2>$null
  if ($LASTEXITCODE -eq 0) { Ok $f } else { Bad $f }
}

Write-Host "3) Серверийн тест"
Push-Location $root
& $Python -m unittest tests.test_server 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "      $_" }
if ($LASTEXITCODE -eq 0) { Ok "test_server.py" } else { Bad "test_server.py" }
Pop-Location

Write-Host "4) Өргөтгөлийн тест (Chrome headless)"
if (-not $Chrome) {
  $Chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
              "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { Bad "Chrome/Edge олдсонгүй" } else {
  $prof = Join-Path $env:TEMP ("hm-test-" + [guid]::NewGuid().ToString("N"))
  Get-ChildItem "$root\tests\pages\*.html" | Where-Object { $_.Name -notlike "*_frame.html" } | ForEach-Object {
    $u = "file:///" + ($_.FullName -replace '\\', '/')
    $out = & $Chrome --headless=new --disable-gpu --no-first-run --allow-file-access-from-files --user-data-dir="$prof" `
                     --window-size=900,700 --virtual-time-budget=20000 --dump-dom $u 2>$null | Out-String
    $res = [regex]::Match($out, 'data-result="([^"]*)"').Groups[1].Value
    if ($res -eq "PASS") { Ok $_.Name } elseif ($res) { Bad "$($_.Name): $([System.Net.WebUtility]::HtmlDecode($res))" } else { Bad "$($_.Name): үр дүн алга" }
  }
  Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "5) Утасны апп (mobile/)"
$mob = Join-Path $root "mobile"
if (-not (Test-Path "$mob\node_modules")) { Write-Host "      (mobile\node_modules алга — 'cd mobile; npm install' хийсний дараа шалгагдана)" } else {
  Push-Location $mob
  npm run --silent typecheck 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "TypeScript (pagetr.js хуулагдсан)" } else { Bad "TypeScript — 'cd mobile; npx tsc --noEmit'" }
  $env:CI = "1"; npx expo lint 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "lint" } else { Bad "lint — 'cd mobile; npx expo lint'" }
  if ($Chrome) {
    $tmp = Join-Path $env:TEMP ("hm-mob-" + [guid]::NewGuid().ToString("N")); New-Item -ItemType Directory $tmp | Out-Null
    foreach ($t in "bridge_page", "pdf_page") {
      npx tsx "tests\$t.ts" "$tmp\$t.html" 2>&1 | Out-Null
      $u = "file:///" + ("$tmp\$t.html" -replace '\\', '/')
      $out = & $Chrome --headless=new --disable-gpu --no-first-run --user-data-dir="$tmp\prof" --virtual-time-budget=20000 --dump-dom $u 2>$null | Out-String
      $res = [System.Net.WebUtility]::HtmlDecode([regex]::Match($out, 'data-result="([^"]*)"').Groups[1].Value)
      if ($res -eq "PASS") { Ok "$t (WebView гүүр)" } elseif ($res) { Bad "${t}: $res" } else { Bad "${t}: үр дүн алга (PDF тест интернэт шаарддаг)" }
    }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}

Write-Host ""
if ($fail) { Write-Host "$fail тест унасан" -ForegroundColor Red; exit 1 } else { Write-Host "Бүх тест амжилттай" -ForegroundColor Green }
