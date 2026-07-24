export interface StepTimingConfig {
  label: string;
  range: string; // 참고용 문항 범위 표시, 예: "18~28번"
  targetMinutes: number;
}

export interface MockExamTimingConfig {
  enabled: boolean; // 세부내용 첨부 여부 (Yes/No)
  step1: StepTimingConfig;
  step2: StepTimingConfig;
  step3: StepTimingConfig;
}

export const DEFAULT_MOCK_EXAM_TIMING_CONFIG: MockExamTimingConfig = {
  enabled: false,
  step1: { label: "Step1", range: "18~28번", targetMinutes: 10 },
  step2: { label: "Step2", range: "35~45번", targetMinutes: 17 },
  step3: { label: "Step3", range: "29~34번", targetMinutes: 17 },
};

export type TimingEvaluation = "fast" | "on_target" | "slow";

export const TIMING_EVALUATION_LABELS: Record<TimingEvaluation, string> = {
  fast: "목표보다 빠름",
  on_target: "적정",
  slow: "목표보다 느림",
};

const TOLERANCE_MINUTES = 2;

/**
 * 실제 소요시간을 목표시간과 비교해 빠름/적정/느림을 판정한다.
 * ±2분은 오차 범위로 보고 "적정"으로 처리한다.
 */
export function evaluateStepTiming(
  actualMinutes: number,
  targetMinutes: number,
): TimingEvaluation {
  if (actualMinutes < targetMinutes - TOLERANCE_MINUTES) return "fast";
  if (actualMinutes > targetMinutes + TOLERANCE_MINUTES) return "slow";
  return "on_target";
}
