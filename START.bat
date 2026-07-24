@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   L16 Student Recorder Lite  -  실행 중...
echo ============================================
echo.

if not exist node_modules (
  echo [1/3] 처음 실행이라 필요한 파일을 설치합니다. 1~2분 정도 걸릴 수 있습니다...
  call npm install
  echo.
)

if not exist .env (
  echo [2/3] 관리자 접속 정보를 새로 만듭니다...
  (
    echo VITE_ADMIN_ACCESS_CODE=change-me-secret
    echo VITE_ADMIN_PASSWORD=change-me-please
    echo VITE_ADMIN_PHONE=
    echo.
    echo # 문자 발송: 솔라피(최소충전 1000원, 우선) 또는 알리고 중 채워진 쪽을 자동 사용합니다.
    echo VITE_SOLAPI_API_KEY=
    echo VITE_SOLAPI_API_SECRET=
    echo VITE_SOLAPI_SENDER=
    echo.
    echo # 알리고 SMS 실제 발송을 원하면 아래 3개를 채우세요 ^(비워두면 콘솔에만 표시됨^)
    echo VITE_ALIGO_API_KEY=
    echo VITE_ALIGO_USER_ID=
    echo VITE_ALIGO_SENDER=
  ) > .env
  echo.
  echo   ⚠ .env 파일을 새로 만들었습니다. 메모장으로 열어서
  echo     VITE_ADMIN_ACCESS_CODE 와 VITE_ADMIN_PASSWORD 를
  echo     원하는 값으로 바꾼 뒤 이 파일을 다시 실행하세요.
  echo.
)

echo [3/3] 서버를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo   - 이 검은 창을 닫으면 서버가 꺼집니다. 사용하는 동안 열어두세요.
echo   - 핸드폰에서 접속하려면: 같은 와이파이에 연결한 뒤,
echo     아래에 나오는 "Network:" 주소를 핸드폰 브라우저에 입력하세요.
echo.

start "" cmd /c "timeout /t 4 >nul && start http://localhost:5173"
call npm run dev -- --host

pause
