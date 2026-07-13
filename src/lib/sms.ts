export interface SmsProvider {
  send(phoneDigits: string, message: string): Promise<void>;
}
