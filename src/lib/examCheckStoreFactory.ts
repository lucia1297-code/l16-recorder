import type { ExamCheckStore } from "./examCheckStore";
import { LocalExamCheckStore } from "./examCheckStore.local";
import { SupabaseExamCheckStore } from "./examCheckStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: ExamCheckStore | null = null;

export function createExamCheckStore(): ExamCheckStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabaseExamCheckStore()
    : new LocalExamCheckStore();
  return singleton;
}
