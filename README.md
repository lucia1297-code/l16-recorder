# ASX Student Recorder Lite (MVP)

학생들이 휴대폰에서 시험 결과와 오답 데이터를 입력·저장하는 모바일 우선 PWA.
React + TypeScript + Vite + vite-plugin-pwa.

## 빠른 시작 (오늘 바로 작동 — localStorage 모드)

```bash
npm install
npm run dev      # http://localhost:5173
```

- 데이터는 브라우저 localStorage 에 저장 (설정 불필요)
- 우측 상단 "관리자 →" 버튼으로 관리자 화면 전환
- 관리자 데모 비밀번호: `asx2026` (실서비스에서 반드시 교체)

## 기능

**학생 플로우** (8단계 마법사, 자동 저장)
학생코드 → 이름·선생님 → 학교·학년 → 시험(연/월/회차/문항수/총점) → 총점 → 오답번호 체크(1~N) → 오답원인(복수) → 회고(어려운 이유/목표/만족도) → 제출

**관리자**
로그인 · 학생 목록 · 이름/코드/학교/학년/시험 검색 · 점수조회 · **CSV Export** (엑셀 한글 BOM 포함)

**대시보드**
제출수 · 평균 · 최고 · 최저 · 전체 오답률 · 오답 많은 문항 TOP · 오답원인 분포 · 학교별 평균

**PWA**
manifest + service worker, 모바일 홈화면 설치 가능, 오프라인 작동

## 테스트 (TDD)

```bash
npm test          # 46개 테스트 (통계/CSV/검증/스토리지/인증/OTP/명부)
```

## 빌드

```bash
npm run build     # dist/ 생성
npm run preview   # 빌드 결과 로컬 미리보기
```

## 관리자 인증

두 가지 모드가 자동으로 전환됩니다 (`.env` 에 Supabase 키가 있는지로 판단):

**Simple 모드 (기본, 설정 불필요)**
- `.env` 의 `VITE_ADMIN_PASSWORD` 로 로그인 (미설정 시 개발용 기본값 `asx2026` 사용 + 콘솔 경고)
- 이메일 불필요, 비밀번호만 입력

**Supabase 모드 (Supabase 키를 `.env`에 넣으면 자동 전환)**
- Supabase Auth 이메일/비밀번호 로그인으로 자동 전환
- Supabase 대시보드 > Authentication > Users 에서 관리자 계정을 미리 만들어두세요
- 세션은 Supabase가 관리 (로그아웃 버튼 제공)

## 명부 업로드 (엑셀)

관리자 화면 > "명부 관리" 탭에서 엑셀 파일을 업로드하면 학생코드·이름·학교·학년·전화번호가 한번에 등록됩니다.

**작성 양식**: `student_roster_template.xlsx` (별도 제공) — 열 순서: 학생코드, 이름, 학교, 학년, 휴대폰번호, 담당교사, 비고

**업로드 후 일어나는 일**
- 명부가 한 건이라도 등록되면, 학생 전화인증 단계는 **등록된 번호만 허용**합니다 (등록 안 된 번호는 "선생님에게 문의하세요" 오류).
- 등록된 번호로 인증에 성공하면 학생코드·이름·학교·학년이 **자동으로 채워집니다** (직접 입력 불필요).
- 명부가 비어 있으면(아직 업로드 전) 기존처럼 학생이 직접 모든 정보를 입력합니다 — 하위 호환.
- 관리자는 "명부 관리" 탭에서 학생별로 "전송" 버튼을 눌러 학생코드를 즉시 문자로 보낼 수 있습니다.

**⚠️ xlsx(SheetJS) 라이브러리 버전 주의**
- 이 프로젝트가 사용하는 엑셀 파싱 라이브러리(`xlsx`)는 npm 공개 레지스트리에 등록된 최신 버전(0.18.5)에 알려진 고위험 취약점(프로토타입 오염, ReDoS)이 있습니다. SheetJS는 이후 버전을 npm이 아닌 자체 CDN(`cdn.sheetjs.com`)에만 배포합니다.
- 이 개발 환경은 `cdn.sheetjs.com`에 접속이 차단되어 있어 부득이 npm의 구버전으로 개발했습니다.
- **실제 배포 전에 아래 명령으로 반드시 패치 버전으로 교체하세요** (선생님 PC에서는 정상 접속됩니다):
  ```powershell
  npm uninstall xlsx
  npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  ```
  교체 후 `npm run build`로 정상 빌드되는지만 확인하면 코드 수정은 필요 없습니다 (API 호환).



**학생**: 8단계 플로우 맨 앞에 "전화인증" 단계가 추가되었습니다. 휴대폰 번호 입력 → 인증번호 받기 → 6자리 입력 → 인증 완료 후에만 다음 단계로 진행합니다.

**관리자**: 로그인(비밀번호 또는 Supabase Auth) 성공 후, `.env`에 `VITE_ADMIN_PHONE`이 설정돼 있으면 2단계 인증(OTP)이 자동으로 요구됩니다. 미설정 시 2단계 인증은 건너뜁니다.

**SMS 발송 — 알리고(Aligo)**
- `.env`에 `VITE_ALIGO_API_KEY`, `VITE_ALIGO_USER_ID`, `VITE_ALIGO_SENDER`를 모두 채우면 실제 문자가 발송됩니다.
- 하나라도 비어있으면 실제 발송 대신 **브라우저 콘솔에 인증번호가 출력**됩니다 (데모/오늘 바로 테스트 가능).
- 발급: https://smartsms.aligo.in (일반 학원에서 널리 쓰는 국내 SMS API)

**⚠️ 보안 주의사항 (지금 구현의 한계, 정직하게 안내)**
- 현재 구현은 **클라이언트(브라우저)에서 직접** Aligo API를 호출합니다. 즉 `.env`에 넣은 API 키가 브라우저 네트워크 요청에 노출됩니다. 빠른 테스트/데모에는 문제없지만, **실제 학생들에게 배포하기 전에는 반드시 서버 뒤로 옮기세요.**
- 인증번호 세션도 현재는 **localStorage**에 저장됩니다 (개발자도구로 열람 가능). 운영 수준 보안이 아닙니다.
- 운영 전환용 템플릿을 `supabase/functions/send-otp/index.ts`, `supabase/functions/verify-otp/index.ts`에 제공했습니다. 이 두 Edge Function을 배포하면 API 키와 인증번호가 서버에만 존재하게 됩니다. (배포: `supabase functions deploy send-otp` 등 — 이 환경에서는 Supabase CLI/API에 접속할 수 없어 제가 직접 배포·테스트하지 못했습니다.)
- 이 환경(제가 코드를 작성하는 샌드박스)은 Aligo·Supabase API 서버에 네트워크 접근이 차단되어 있어, **실제 문자 발송이 되는지는 제가 직접 확인하지 못했습니다.** 선생님 PC에서 `.env`를 채우고 `npm run dev`로 직접 테스트해 주세요.



1. Supabase 프로젝트 생성 후 `supabase/schema.sql` 을 SQL Editor 에서 실행
   - RLS 정책: 학생 제출(insert)은 익명 허용, 조회(select)는 로그인한 관리자만 허용
2. Authentication > Users 에서 관리자 계정(이메일/비밀번호) 생성
3. `.env` 파일 생성 (`.env.example` 참고):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
4. 끝 — `npm run dev` 재시작하면 자동으로 Supabase 저장 + Supabase 로그인으로 전환됩니다.
   (코드 수정 불필요: `storageFactory.ts`/`authFactory.ts` 가 환경변수를 감지해서 자동 전환)

> 참고: `@supabase/supabase-js` 는 이미 `package.json` 에 포함되어 `npm install` 시 함께 설치됩니다.
> 이 환경에서는 Supabase API에 직접 접속해 실제 연동 테스트를 하지 못했습니다 — 선생님 PC에서 위 절차대로 `.env`를 채우고 `npm run dev` 후 직접 확인해 주세요.

## Netlify 배포

**방법 A — Git 연동 (권장)**
1. 이 폴더를 GitHub 저장소로 push
2. Netlify > Add new site > Import an existing project
3. Build command: `npm run build`, Publish directory: `dist`
4. (Supabase 사용 시) Site settings > Environment variables 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가

**방법 B — CLI**
```bash
npm run build
npx netlify-cli deploy --prod --dir=dist
```

`netlify.toml` 이 포함되어 있어 빌드 설정은 자동 적용됩니다.

## 알려진 이슈

- `npm audit` 에 esbuild/vite 관련 개발 서버 취약점 경고가 있습니다 (dev server 전용, 프로덕션 빌드에는 영향 없음). 필요시 `npm audit fix --force` 로 vite 6→8 업그레이드 가능하나 breaking change 포함.

## 폴더 구조

```
src/
  core/       types.ts, logic.ts(순수함수·테스트대상), future.ts(미래기능 인터페이스)
  lib/        storage.ts(인터페이스), storage.local.ts, storage.supabase.ts, storageFactory.ts
  features/
    student/  StudentFlow.tsx (8단계 마법사)
    admin/    AdminPanel.tsx  (목록·검색·CSV·대시보드)
  __tests__/  logic.test.ts, storage.test.ts
supabase/schema.sql
```

## 미래 기능 (인터페이스만, 미구현)

`src/core/future.ts` 에 자리만 확보: ASX_CSC, HELIX, AI 분석, PDF 리포트, 성장 그래프.
