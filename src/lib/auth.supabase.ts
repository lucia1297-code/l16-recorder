import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Auth, AuthResult } from "./auth";

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      "Supabase 환경변수(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)가 없습니다.",
    );
  }
  cachedClient = createClient(url, key);
  return cachedClient;
}

export class SupabaseAuth implements Auth {
  requiresEmail = true;
  private loggedIn = false;

  constructor() {
    // 세션 복구 시도 (탭 재로드 대응)
    getClient()
      .auth.getSession()
      .then(({ data }) => {
        this.loggedIn = Boolean(data.session);
      })
      .catch(() => {
        this.loggedIn = false;
      });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const { error } = await getClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { ok: false, error: error.message };
      this.loggedIn = true;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async logout(): Promise<void> {
    await getClient().auth.signOut();
    this.loggedIn = false;
  }

  isLoggedIn(): boolean {
    return this.loggedIn;
  }
}
