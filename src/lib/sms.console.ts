import type { SmsProvider } from "./sms";

/**
 * API 키가 없을 때 사용하는 폴백. 실제 문자를 보내지 않고 콘솔에 출력한다.
 * .env 에 알리고 키를 넣으면 자동으로 AligoSmsProvider 로 전환된다.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async send(phoneDigits: string, message: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn(
      `[ASX] SMS 미설정 — 실제 발송 안 됨. (.env 의 VITE_ALIGO_* 설정 필요)\n` +
        `받는 사람: ${phoneDigits}\n메시지: ${message}`,
    );
  }
}
