import type { Storage } from "./storage";
import { LocalStorage } from "./storage.local";
// import { SupabaseStorage } from "./storage.supabase";

/**
 * 백엔드 전환 지점.
 * 오늘: LocalStorage (설정 불필요, 즉시 작동)
 * Supabase 전환: 아래 두 줄을 주석 처리/해제만 하면 됨.
 */
export function createStorage(): Storage {
  return new LocalStorage();
  // return new SupabaseStorage();
}
