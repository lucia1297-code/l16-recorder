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

  constructor(private readonly client: Pick<SupabaseClient, "auth"> = getClient()) {}

  async restore(): Promise<boolean> {
    try {
      const { data } = await this.client.auth.getSession();
      this.loggedIn = Boolean(data.session);
    } catch {
      this.loggedIn = false;
    }
    return this.loggedIn;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    try {
      const { error } = await this.client.auth.signInWithPassword({
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
    await this.client.auth.signOut();
    this.loggedIn = false;
  }

  isLoggedIn(): boolean {
    return this.loggedIn;
  }
}
