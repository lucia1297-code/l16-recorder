# L16 수업 판단 기록 → ASX/HELIX 전달 계약 초안

상태: **계약 초안만 작성됨. 런타임 연동·전송은 미구현.**  
대상: L16 수업 기록에서 만들어지는 교사 판단 이벤트 및 보완 이력.  
기준 버전: `schemaVersion = "1.0"`.

## 목적과 경계

이 문서는 향후 L23/ASX가 검토할 데이터 형식을 정의한다. 현재 구현은 L16 내 로컬 저장 또는 별도 Supabase 테이블 저장까지만 수행한다. 확인되지 않은 ASX endpoint, 인증 방식, 업로드 주기, HELIX 분석 결과 형식을 가정하지 않는다. 외부 전송은 수신자·목적·동의 상태·보존 기간·삭제 및 재전송 정책이 별도 승인되고 계약이 확정될 때까지 금지한다.

## 이벤트 봉투

```json
{
  "eventId": "UUID",
  "schemaVersion": "1.0",
  "eventType": "item_outcome",
  "recordedAt": "2026-11-18T03:00:00.000Z",
  "lessonDate": "2026-11-18",
  "studentCode": "opaque-code-or-null",
  "sessionRef": "opaque-session-ref-or-null",
  "itemId": "opaque-item-id-or-null",
  "itemVersion": "version-or-null",
  "outcome": "incorrect",
  "judgmentCode": null,
  "reasonTags": ["inference"],
  "recordStatus": "quick_saved",
  "detail": {
    "initialHypothesis": "",
    "observedFact": "",
    "studentStatement": "",
    "teacherInterpretation": "",
    "revisionReason": "",
    "strategyApplied": "",
    "observedOutcome": "",
    "nextHypothesis": ""
  }
}
```

허용 `eventType`: `item_outcome`, `judgment_changed`, `new_discovery`, `explanation_effect`, `follow_up_review`, `lesson_plan_saved`, `lesson_review_saved`.  
허용 `outcome`: `correct`, `incorrect`, `hold`, `unverified`. `hold`는 의도적 판단 보류이고 `unverified`는 정오/증거 미확인이다.  
허용 `judgmentCode`: `J-01`~`J-04`. `reasonTags`: `vocabulary`, `sentence_structure`, `logic`, `inference`, `choice_judgment`, `time`, `other`.

## 보완 이력

이벤트를 덮어쓰지 않고 아래 형식의 revision을 추가한다.

```json
{
  "revisionId": "UUID",
  "eventId": "parent-event-UUID",
  "revisionNo": 1,
  "createdAt": "2026-11-18T04:00:00.000Z",
  "detail": { "observedFact": "...", "teacherInterpretation": "..." }
}
```

`revisionNo`는 이벤트별로 1부터 증가하며 `revisionId`와 `(eventId, revisionNo)`는 중복될 수 없다. 이력의 사실·학생 진술·교사 해석·가설을 서로 대체하거나 자동 분류하지 않는다.

## 개인정보 및 목적 제한

- 학생 이름과 연락처를 이벤트 봉투나 브라우저 outbox에 복제하지 않는다. `studentCode`도 식별 가능한 코드로 취급하고 접근을 제한한다.
- 자유 입력에는 학생 이름, 연락처, 불필요한 민감정보를 적지 않도록 UI에서 안내한다.
- 미전송 이벤트와 상세 편집 초안은 브라우저 `localStorage`에 평문으로 보관된다. 이 저장소의 기기 계정·브라우저 권한을 보호하고 공용기기 사용을 피하는 운영 기준이 필요하다.
- 교사 본인의 사실 기록과 해석 구분을 유지한다. 자동 진단·성적 순위·처방·문항 생성은 이 계약에 포함하지 않는다.
- 외부 ASX/HELIX 전송 전에는 consent/purpose 상태의 원본, `consent_epoch`, 철회 처리, 최소 데이터 범위, 보유·삭제 규칙, 재전송 정책 및 감사 추적 연결을 확정해야 한다. 현재 스키마/코드는 이를 아직 구현하지 않았다.
- 외부 전송 계약 확정 전에는 이벤트를 ASX 식별자나 HELIX 판단으로 변환하지 않는다.

## 멱등성·오류 처리 제안

`eventId`를 외부 수신 계약에서도 idempotency key로 보존하고, 서버는 동일 ID·동일 payload를 재전송 성공으로 처리해야 한다. 동일 ID·다른 payload는 충돌로 보고 거부해야 한다. 네트워크 오류는 보존·재시도하되 자동 만료하지 않으며, 사용자 삭제는 확인을 거친다. 수신 측 acknowledgement, retry backoff, 최대 재시도, dead-letter 및 삭제 동기화는 아직 미정이다.

## 구현 상태

| 항목 | 상태 |
|---|---|
| L16 이벤트·revision TypeScript 타입 | 구현 |
| 로컬 저장 및 브라우저 outbox | 구현 |
| Supabase 테이블 adapter와 초안 migration | 구현, migration 미적용 |
| ASX endpoint·인증·전송 | 미구현 |
| HELIX 증거 해석·진단·처방 | 미구현 |
| 동의 epoch·철회 기반 외부 전달 게이트 | 미구현, 외부 전달 선결조건 |
