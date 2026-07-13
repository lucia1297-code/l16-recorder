import type { AssignmentStore } from "./assignmentStore";
import { LocalAssignmentStore } from "./assignmentStore.local";
import { SupabaseAssignmentStore } from "./assignmentStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: AssignmentStore | null = null;

export function createAssignmentStore(): AssignmentStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabaseAssignmentStore()
    : new LocalAssignmentStore();
  return singleton;
}
