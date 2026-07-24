import type { TeacherLogStore } from "./teacherLogStore";
import { LocalTeacherLogStore } from "./teacherLogStore.local";
import { SupabaseTeacherLogStore } from "./teacherLogStore.supabase";
import { isSupabaseConfigured } from "../core/authLogic";

let singleton: TeacherLogStore | null = null;

export function createTeacherLogStore(): TeacherLogStore {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  singleton = isSupabaseConfigured(url, key)
    ? new SupabaseTeacherLogStore()
    : new LocalTeacherLogStore();
  return singleton;
}
