export const GRACE_PERIOD_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 신규 등록 후 2주(계도기간) 이내인지 판단한다.
 * registeredAt 이 없으면(기존에 등록된 학생) 계도기간이 아닌 것으로 처리한다.
 */
export function isInGracePeriod(registeredAt: string | undefined, now: Date): boolean {
  if (!registeredAt) return false;
  const elapsedDays = (now.getTime() - new Date(registeredAt).getTime()) / MS_PER_DAY;
  return elapsedDays < GRACE_PERIOD_DAYS;
}

/**
 * 계도기간이 며칠 남았는지 (0이면 종료됨 또는 해당없음).
 */
export function gracePeriodDaysRemaining(registeredAt: string | undefined, now: Date): number {
  if (!registeredAt) return 0;
  const elapsedDays = (now.getTime() - new Date(registeredAt).getTime()) / MS_PER_DAY;
  const remaining = GRACE_PERIOD_DAYS - elapsedDays;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}
