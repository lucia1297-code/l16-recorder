import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimpleAuth } from "../lib/auth.simple";
import { SupabaseAuth } from "../lib/auth.supabase";

describe("administrator session restoration", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("restores the local fallback session", async () => {
    sessionStorage.setItem("asx.admin.session", "1");
    await expect(new SimpleAuth().restore()).resolves.toBe(true);
  });

  it("restores and logs out a Supabase Master session", async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "token" } } });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const auth = new SupabaseAuth({
      auth: {
        getSession,
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        signOut,
      },
    } as any);

    await expect(auth.restore()).resolves.toBe(true);
    expect(auth.isLoggedIn()).toBe(true);
    await auth.logout();
    expect(signOut).toHaveBeenCalledOnce();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it("never writes a password to browser storage", async () => {
    const auth = new SupabaseAuth({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    } as any);
    await auth.login("master@example.com", "do-not-store-this");
    expect(JSON.stringify({ ...localStorage })).not.toContain("do-not-store-this");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("do-not-store-this");
  });
});
