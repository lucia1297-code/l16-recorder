// Supabase Edge Function 템플릿 — 운영 배포 시 OTP 발송을 서버로 옮기기 위한 참고 코드.
// 클라이언트에서 SMS API 키를 직접 쓰지 않도록, 이 함수를 배포하고
// otpService 가 이 엔드포인트를 호출하도록 바꾸면 키가 브라우저에 노출되지 않는다.
//
// 배포: supabase functions deploy send-otp
// 환경변수(Supabase 대시보드 > Edge Functions > Secrets):
//   ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER, SUPABASE_SERVICE_ROLE_KEY 등
//
// Deno 런타임 기준 (Supabase Edge Functions 표준).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "phone required" }), { status: 400 });
    }
    const digits = phone.replace(/[^0-9]/g, "");
    if (!/^01[016789]\d{7,8}$/.test(digits)) {
      return new Response(JSON.stringify({ error: "invalid phone" }), { status: 400 });
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // 서버 권한(Service Role)으로 Supabase 에 OTP 세션 저장 (RLS 우회, 서버에서만 실행됨)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("otp_sessions").upsert({
      phone: digits,
      code,
      expires_at: expiresAt,
      attempts: 0,
    });

    // 알리고 SMS 발송
    const body = new URLSearchParams({
      key: Deno.env.get("ALIGO_API_KEY")!,
      user_id: Deno.env.get("ALIGO_USER_ID")!,
      sender: Deno.env.get("ALIGO_SENDER")!,
      receiver: digits,
      msg: `[ASX] 인증번호는 ${code} 입니다. 5분 이내에 입력하세요.`,
      msg_type: "SMS",
    });
    const smsRes = await fetch("https://apis.aligo.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const smsData = await smsRes.json();
    if (Number(smsData.result_code) < 0) {
      return new Response(JSON.stringify({ error: smsData.message }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
