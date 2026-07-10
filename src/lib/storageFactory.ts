import type { Storage } from "./storage";
import { LocalStorage } from "./storage.local";
import { SupabaseStorage } from "./storage.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: Storage | null = null;

/**
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정돼 있으면 자동으로 Supabase 사용,
 * 없으면 localStorage 사용 (설정 불필요, 즉시 작동).
 */
export function createStorage(): Storage {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key) ? new SupabaseStorage() : new LocalStorage();
  return singleton;
}
