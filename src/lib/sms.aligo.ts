import type { SmsProvider } from "./sms";

/**
 * 알리고(Aligo) SMS API 연동.
 * https://smartsms.aligo.in/admin/api/spec.html
 *
 * ⚠️ 보안 주의: 이 구현은 브라우저(클라이언트)에서 API 키를 직접 사용합니다.
 * 데모/빠른 테스트용으로는 동작하지만, API 키가 브라우저 네트워크 탭에 노출됩니다.
 * 운영 배포 전에는 반드시 Supabase Edge Function(서버) 뒤로 옮기세요.
 * 템플릿: supabase/functions/send-otp/index.ts
 */
export class AligoSmsProvider implements SmsProvider {
  private apiKey: string;
  private userId: string;
  private sender: string;

  constructor(apiKey: string, userId: string, sender: string) {
    this.apiKey = apiKey;
    this.userId = userId;
    this.sender = sender;
  }

  async send(phoneDigits: string, message: string): Promise<void> {
    const body = new URLSearchParams({
      key: this.apiKey,
      user_id: this.userId,
      sender: this.sender,
      receiver: phoneDigits,
      msg: message,
      msg_type: "SMS",
    });

    const res = await fetch("https://apis.aligo.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      throw new Error(`SMS 발송 실패 (HTTP ${res.status})`);
    }
    const data = await res.json();
    // 알리고 응답: { result_code: '1', message: 'success', ... } / 실패시 result_code < 0
    if (data.result_code === undefined || Number(data.result_code) < 0) {
      throw new Error(`SMS 발송 실패: ${data.message ?? "알 수 없는 오류"}`);
    }
  }
}
