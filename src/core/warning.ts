import type { AssignmentStatus } from "./assignment";

export interface WarningRecord {
  studentCode: string;
  typeId: string;
  count: number; // 누적 경고 횟수
  lastWarnedAt: string; // ISO — "새로운 경고" 표시 판단용
}

const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3일

/**
 * 최근(3일 이내)에 경고가 갱신됐는지 — 관리자 화면에 "NEW" 표시 여부 판단용.
 */
export function isRecentWarning(lastWarnedAt: string, now: Date): boolean {
  return now.getTime() - new Date(lastWarnedAt).getTime() < RECENT_WINDOW_MS;
}

/**
 * 과제 지정 개수를 늘려 다음 회차로 "이월"할 때 호출한다.
 * 그 시점에 학생 상태가 여전히 "경고"면 누적 횟수를 1 늘리고 lastWarnedAt 을 갱신한다.
 * 그 외 상태(good/not_bad/none)면 기존 기록을 그대로 둔다.
 */
export function bumpWarningOnCarryOver(
  existing: WarningRecord[],
  studentCode: string,
  typeId: string,
  status: AssignmentStatus,
  now: Date,
): WarningRecord[] {
  if (status !== "warning") return existing;

  const idx = existing.findIndex((r) => r.studentCode === studentCode && r.typeId === typeId);
  if (idx === -1) {
    return [...existing, { studentCode, typeId, count: 1, lastWarnedAt: now.toISOString() }];
  }
  const updated = [...existing];
  updated[idx] = { ...updated[idx], count: updated[idx].count + 1, lastWarnedAt: now.toISOString() };
  return updated;
}

/**
 * 관리자가 "경고 초기화" 버튼을 누르면 호출 — 제출기록은 그대로 두고 누적 횟수만 0으로.
 */
export function resetWarningCount(
  existing: WarningRecord[],
  studentCode: string,
  typeId: string,
): WarningRecord[] {
  const idx = existing.findIndex((r) => r.studentCode === studentCode && r.typeId === typeId);
  if (idx === -1) return existing;
  const updated = [...existing];
  updated[idx] = { ...updated[idx], count: 0 };
  return updated;
}
