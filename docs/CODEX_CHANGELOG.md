# Codex 변경 기록

기준 저장소: D:\내문서_복사_0605\ASX_Recorder\l16-recorder-source\asx-recorder

## 공식 폴더에 복사된 결과물

- native/l16-admin-android/
  - Android 관리자 녹음기 소스
  - Foreground Service 마이크 녹음
  - 2분 단위 m4a 분할
  - 화면 잠금·앱 전환 중 녹음 유지 시도
  - segments.jsonl 메타데이터 기록
  - 설정 시 Supabase Storage 업로드 시도
  - build-admin.ps1 빌드 검사 스크립트

## 웹 변경 기록

별도 작업 폴더에서 확인된 일정 제목 한글 입력 오류 원인은 내부 Form 컴포넌트가 매 입력마다 재장착되는 문제였습니다. 해결 커밋은 e661498입니다.

공식 main에는 SchedulePanel.tsx와 student_schedules 기능이 없어 해당 웹 수정은 공식 main에 적용하지 않았습니다.

## 배포

공식 저장소 push는 GitHub 연결 오류로 확인하지 못했습니다.
