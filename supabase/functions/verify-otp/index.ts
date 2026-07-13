// Supabase Edge Function 템플릿 — OTP 검증을 서버에서 수행 (인증번호가 클라이언트에 노출되지 않음).
// 배포: supabase functions deploy verify-otp
//
// 사용하려면 otp_sessions 테이블이 필요합니다:
//   create table otp_sessions (
//     phone text primary key,
//     code text not null,
//     expires_at timestamptz not null,
//     attempts int not null default 0
//   );
//   alter table otp_sessions enable row level security;
//   -- 이 테이블은 서버(Service Role)에서만 접근 (별도 정책 불필요 = 기본적으로 anon 접근 차단)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_ATTEMPTS = 5;

Deno.serve(async (req: Request) => {
  try {
    const { phone, code } = await req.json();
    const digits = String(phone ?? "").replace(/[^0-9]/g, "");
    if (!digits || !code) {
      return new Response(JSON.stringify({ ok: false, error: "phone/code required" }), {
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: session, error } = await supabase
      .from("otp_sessions")
      .select("*")
      .eq("phone", digits)
      .maybeSingle();

    if (error || !session) {
      return new Response(JSON.stringify({ ok: false, error: "먼저 인증번호를 요청하세요." }), {
        status: 404,
      });
    }
    if (session.attempts >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ ok: false, error: "인증 시도 횟수를 초과했습니다." }),
        { status: 429 },
      );
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ ok: false, error: "인증번호가 만료되었습니다." }), {
        status: 410,
      });
    }
    if (String(code).trim() !== session.code) {
      await supabase
        .from("otp_sessions")
        .update({ attempts: session.attempts + 1 })
        .eq("phone", digits);
      return new Response(JSON.stringify({ ok: false, error: "인증번호가 일치하지 않습니다." }), {
        status: 401,
      });
    }

    await supabase.from("otp_sessions").delete().eq("phone", digits);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
