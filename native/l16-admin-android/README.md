# L16 관리자 Android 녹음기

이 폴더는 관리자용 Android 네이티브 녹음 앱의 1차 구현입니다.

현재 구현된 동작:

- Android Foreground Service로 마이크 녹음
- 화면 잠금 및 다른 앱 전환 중에도 서비스 유지 시도
- 2분마다 `.m4a` 파일로 자동 분할 저장
- Android 13 이상 알림 권한 요청
- 서비스가 종료되었다가 시스템에 의해 재생성될 때 `START_STICKY`로 재시작
- 각 분할 파일의 메타데이터를 `recordings/segments.jsonl`에 기록
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, 학생 코드가 설정되면 분할 파일을 Storage에 백그라운드 업로드

파일은 앱 전용 외부 저장소의 `recordings` 폴더에 저장됩니다. `segments.jsonl`에는 파일명, 시작·종료 시각, 길이, 바이트 수가 한 줄씩 기록됩니다. 업로드가 실패해도 로컬 파일은 유지됩니다. Whisper 전사와 DB 레코드 생성은 아직 연결하지 않았습니다.

## 빌드

Android Studio에서 이 폴더를 열고 Gradle Sync 후 `app`을 실행합니다.

`gradle.properties`에 다음 값을 넣으면 Storage 업로드를 켤 수 있습니다(키는 APK에 포함되므로 OpenAI 비밀 키는 넣지 않습니다).

```properties
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

PowerShell에서 SDK와 Gradle이 준비된 경우:

```powershell
Set-Location "C:\Users\Kim Min Soo\Documents\ChatGPT\NS-WW\l16-admin-android"
gradle :app:assembleDebug
```

생성 APK 경로:

`app\build\outputs\apk\debug\app-debug.apk`

현재 작업 컴퓨터에는 `gradle`, `adb`, Android SDK가 확인되지 않아 APK 생성과 실제 Galaxy 기기 설치 검증은 아직 수행하지 않았습니다.
