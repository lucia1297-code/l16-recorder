import type { MockExamTimingStore } from "./mockExamTimingStore";
import type { MockExamTimingConfig } from "../core/mockExamTiming";
import { DEFAULT_MOCK_EXAM_TIMING_CONFIG } from "../core/mockExamTiming";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  cachedClient = createClient(url, key);
  return cachedClient;
}

const SINGLETON_ID = "default";

/**
 * mock_exam_timing_config 테이블 사용 — 항상 id='default' 인 단일 행만 다룬다.
 */
export class SupabaseMockExamTimingStore implements MockExamTimingStore {
  async getConfig(): Promise<MockExamTimingConfig> {
    const sb = getClient();
    const { data, error } = await sb
      .from("mock_exam_timing_config")
      .select("*")
      .eq("id", SINGLETON_ID)
      .maybeSingle();
    if (error) throw error; // 테이블이 없거나 권한 문제 등 — 조용히 기본값으로 넘어가지 않고 알린다
    if (!data) return DEFAULT_MOCK_EXAM_TIMING_CONFIG; // 행이 아직 없는 정상 상태(첫 사용)
    return {
      enabled: data.enabled,
      step1: { label: data.step1_label, range: data.step1_range, targetMinutes: data.step1_target },
      step2: { label: data.step2_label, range: data.step2_range, targetMinutes: data.step2_target },
      step3: { label: data.step3_label, range: data.step3_range, targetMinutes: data.step3_target },
    };
  }

  async saveConfig(config: MockExamTimingConfig): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("mock_exam_timing_config").upsert(
      {
        id: SINGLETON_ID,
        enabled: config.enabled,
        step1_label: config.step1.label,
        step1_range: config.step1.range,
        step1_target: config.step1.targetMinutes,
        step2_label: config.step2.label,
        step2_range: config.step2.range,
        step2_target: config.step2.targetMinutes,
        step3_label: config.step3.label,
        step3_range: config.step3.range,
        step3_target: config.step3.targetMinutes,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }
}
