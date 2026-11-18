import { isSupabaseConfigured } from "../core/authLogic";
import type { LessonJudgmentStore } from "./lessonJudgmentStore";
import { LocalLessonJudgmentStore } from "./lessonJudgmentStore.local";
import { SupabaseLessonJudgmentStore } from "./lessonJudgmentStore.supabase";

let singleton: LessonJudgmentStore | null = null;

export function createLessonJudgmentStore(): LessonJudgmentStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key) ? new SupabaseLessonJudgmentStore() : new LocalLessonJudgmentStore();
  return singleton;
}
