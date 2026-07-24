import type { SmsProvider } from "./sms";
import { hmacSha256Hex, randomHex } from "./solapiAuth";

/**
 * 솔라피(Solapi) SMS API 연동.
 * https://developers.solapi.com
 *
 * 알리고보다 최소 충전 금액이 낮아(계좌이체 1,000원부터) 소규모로 시작하기 좋다.
 *
 * ⚠️ 보안 주의: 이 구현은 브라우저(클라이언트)에서 API Secret으로 직접 서명합니다.
 * 데모/빠른 테스트용으로는 동작하지만, API Secret이 브라우저 네트워크 요청에 노출됩니다.
 * 운영 배포 전에는 반드시 서버(Supabase Edge Function 등) 뒤로 옮기세요.
 */
export class SolapiSmsProvider implements SmsProvider {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private sender: string,
  ) {}

  async send(phoneDigits: string, message: string): Promise<void> {
    const date = new Date().toISOString();
    const salt = randomHex(32);
    const signature = await hmacSha256Hex(this.apiSecret, date + salt);
    const authHeader = `HMAC-SHA256 apiKey=${this.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        message: {
          to: phoneDigits,
          from: this.sender,
          text: message,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SMS 발송 실패 (HTTP ${res.status}): ${body}`);
    }
  }
}
