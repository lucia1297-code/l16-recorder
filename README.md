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
npm test          # 19개 테스트 (통계/CSV/검증/스토리지/인증)
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

## Supabase 로 전환 (선택)

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
