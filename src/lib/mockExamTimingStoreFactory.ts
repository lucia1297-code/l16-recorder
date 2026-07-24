import type { MockExamTimingStore } from "./mockExamTimingStore";
import { LocalMockExamTimingStore } from "./mockExamTimingStore.local";
import { SupabaseMockExamTimingStore } from "./mockExamTimingStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: MockExamTimingStore | null = null;

export function createMockExamTimingStore(): MockExamTimingStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabaseMockExamTimingStore()
    : new LocalMockExamTimingStore();
  return singleton;
}
