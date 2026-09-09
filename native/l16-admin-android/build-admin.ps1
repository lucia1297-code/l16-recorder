$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk -and (Test-Path (Join-Path $project 'local.properties'))) {
  $line = Get-Content (Join-Path $project 'local.properties') | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
  if ($line) { $sdk = ($line -replace '^sdk\.dir=', '') -replace '\\\\', '\\' }
}
if (-not $sdk -or -not (Test-Path (Join-Path $sdk 'platform-tools'))) {
  throw 'Android SDK not found. Install Android Studio, then install Android SDK and Build-Tools from SDK Manager.'
}
$gradle = Get-Command gradle -ErrorAction SilentlyContinue
if (-not $gradle) { throw 'Gradle not found. Open the project in Android Studio and run Gradle Sync, or install Gradle.' }
Set-Location $project
gradle :app:assembleDebug
Write-Host "APK: $project\app\build\outputs\apk\debug\app-debug.apk"
