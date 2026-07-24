import type { WarningStore } from "./warningStore";
import { LocalWarningStore } from "./warningStore.local";
import { SupabaseWarningStore } from "./warningStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: WarningStore | null = null;

export function createWarningStore(): WarningStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key) ? new SupabaseWarningStore() : new LocalWarningStore();
  return singleton;
}
