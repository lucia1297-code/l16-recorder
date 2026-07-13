import type { PendingStore } from "./pendingStore";
import { LocalPendingStore } from "./pendingStore.local";
import { SupabasePendingStore } from "./pendingStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: PendingStore | null = null;

export function createPendingStore(): PendingStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabasePendingStore()
    : new LocalPendingStore();
  return singleton;
}
