/**
 * 학생 리포트 링크 토큰 생성/검증
 * HMAC-SHA256 기반 — 위변조 불가
 */

const SECRET = import.meta.env.VITE_ADMIN_ACCESS_CODE ?? "l16-report-secret";

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16); // 16자리만 사용
}

export async function generateReportToken(studentCode: string): Promise<string> {
  return hmac(studentCode);
}

export async function verifyReportToken(studentCode: string, token: string): Promise<boolean> {
  const expected = await hmac(studentCode);
  return expected === token;
}

export function buildReportUrl(studentCode: string, token: string): string {
  return `${window.location.origin}${window.location.pathname}#report/${studentCode}/${token}`;
}

export function parseReportHash(): { studentCode: string; token: string } | null {
  const hash = window.location.hash;
  const match = hash.match(/^#report\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { studentCode: match[1], token: match[2] };
}
