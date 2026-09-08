# L16 2분 녹음 설계

사용자 승인: 2분 자동 저장 → 서버 저장 확인 → 구간별 전사 → 수업 종료 후 전체 분석을 Codex가 구현한다.

## 범위와 구성

기존 Supabase와 GitHub Pages를 유지한다. 과제·학생 인증 및 문자 기능은 변경하지 않는다. 기존 녹음 원본을 보존한다. 새로운 녹음은 독립 재생 가능한 모노 32kbps MP3로 약 120초마다 생성한다. 단순 MediaRecorder timeslice Blob은 사용하지 않는다. AudioWorklet에서 샘플을 연속 수집하고 전용 Worker에서 인코딩한다. 각 샘플은 정확히 한 구간에 속한다. 브라우저가 캡처를 중지/지연시키면 경고하며 잠금화면 녹음 보장을 주장하지 않는다.

구간은 먼저 IndexedDB에 저장하고 업로드 응답 확인 전 제거하지 않는다. 녹음과 업로드/전사는 별도 상태다. 오프라인/실패 구간은 순서대로 재시도한다. 완료된 구간과 전사 결과는 재사용한다. 서버 데이터에 소유자, 세션, 순번, 해시를 보관한다. 새로고침 후 미완료 세션을 복원하고 원본 MP3 다운로드를 제공한다.

서버는 Supabase Edge Function recording-service로 구성한다. Supabase Auth 사용자 JWT를 서버에서 검증하고 app_metadata.role=master 또는 별도 RECORDING_MASTER_USER_ID로 Master를 제한한다. 기존 브라우저의 Master 화면 플래그는 서버 인증으로 신뢰하지 않는다. 사용자가 직접 설정한 Master 계정의 이메일/비밀번호 로그인을 녹음 패널에서 제공한다. OpenAI 키는 OPENAI_API_KEY 서버 Secret에만 존재한다. 현재 유효한 키와 Supabase 배포 자격 증명이 없으므로 준비 완료/운영 완료를 구분한다.

## API 계약

기본 경로 `${SUPABASE_URL}/functions/v1/recording-service`. JSON POST는 `{action,...}`를 받으며 모든 경로는 Master JWT 필수. 에러는 `{error,code}`와 적절한 HTTP 상태, 성공은 JSON. 신뢰할 수 없는 provider 오류 원문/키는 반환하지 않는다.

- `create`: `{sessionId,studentCode,studentName,startedAt}` -> `{session}`. UUID sessionId로 멱등 생성, 학생 이름은 서버에서 조회한 값 우선.
- `list`: -> `{sessions:[{id,student_code,student_name,started_at,status,expected_chunks,transcript,analysis,keywords,chunks:[{sequence,status,duration_ms,error_code}]}]}`. 소유자 세션만 반환.
- 업로드: multipart FormData `{action:'upload',sessionId,sequence,durationMs,sha256,file}` -> `{chunk}`. 최대 2MB MP3, 같은 순번/해시는 멱등, 충돌은 409.
- `transcribe`: `{sessionId,sequence}` -> `{chunk}`. 서버 저장된 MP3만 OpenAI로 전송하고 성공 텍스트를 영속 저장. lease/동시 호출 차단, 실패와 만료 작업 재시도.
- `finish`: `{sessionId,expectedChunks}` -> `{session}`. 0..N-1 순서와 개수 검사, 부족하면 완료 금지. 녹음은 종료하되 전사는 대기 가능.
- `analyze`: `{sessionId}` -> `{session}`. finish와 모든 구간 전사 완료 필수. 순서대로 전사 결합 후 GPT 분석. 분석 실패 시 전사 보존. 저장 성공 시에만 done.
- `download`: `{sessionId,sequence}` -> `{url}` 짧은 유효기간의 서명 URL.
- `legacy-transcribe`: multipart `{action,recordingId,sequence,total,file}`. 기존 recording의 존재 확인 후 서버 OpenAI 전사. 큰 기존 파일은 로컬에서 분할하는 기존 코드를 재사용하며 DB 원본은 변경하지 않는다.
- `legacy-analyze`: `{recordingId,transcript}` -> `{analysis,keywords}`. 서버 GPT 후 기존 lesson_recordings 결과 업데이트 성공 확인. 학생 이름은 서버 조회.

## 수락 조건

자동 테스트: 파일 독립 디코딩, 정확한 샘플 구간, 마지막 부분 저장, 저장 실패 시 업로드 금지, 업로드 실패 보존, 중복/순번 처리, 로그인/권한/소유자 거부, 전사 재사용, 미완료 세션 분석 차단. 실제 브라우저의 합성 오디오가 2분 경계를 넘어 생성되는지 검사한다. 원본 학생 음성 전사, 실제 휴대폰 잠금/앱전환 검증은 각각 별도 기록한다. dist 미커밋, Actions 빌드만 배포한다.
