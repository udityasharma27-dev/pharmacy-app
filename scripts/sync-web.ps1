$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root "web"
$files = @(
  "index.html",
  "app.html",
  "checkout.html",
  "app.css",
  "app.js",
  "pwa.js",
  "api-base.js",
  "manifest.webmanifest",
  "sw.js",
  "qr.png"
)

New-Item -ItemType Directory -Force $web | Out-Null

foreach ($file in $files) {
  Copy-Item (Join-Path $root $file) (Join-Path $web $file) -Force
}
