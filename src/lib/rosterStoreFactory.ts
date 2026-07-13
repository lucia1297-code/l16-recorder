import type { RosterStore } from "./rosterStore";
import { LocalRosterStore } from "./rosterStore.local";
import { SupabaseRosterStore } from "./rosterStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: RosterStore | null = null;

export function createRosterStore(): RosterStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabaseRosterStore()
    : new LocalRosterStore();
  return singleton;
}
