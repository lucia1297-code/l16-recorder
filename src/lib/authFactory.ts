import type { Auth } from "./auth";
import { SimpleAuth } from "./auth.simple";
import { SupabaseAuth } from "./auth.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let cached: Auth | null = null;

/**
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정돼 있으면 자동으로 Supabase Auth 사용,
 * 없으면 환경변수 비밀번호 기반 SimpleAuth 사용.
 */
export function createAuth(): Auth {
  if (cached) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  cached = isSupabaseConfigured(url, key) ? new SupabaseAuth() : new SimpleAuth();
  return cached;
}
