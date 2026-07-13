import type { SmsProvider } from "./sms";
import { AligoSmsProvider } from "./sms.aligo";
import { ConsoleSmsProvider } from "./sms.console";

let cached: SmsProvider | null = null;

export function createSmsProvider(): SmsProvider {
  if (cached) return cached;
  const apiKey = import.meta.env.VITE_ALIGO_API_KEY as string | undefined;
  const userId = import.meta.env.VITE_ALIGO_USER_ID as string | undefined;
  const sender = import.meta.env.VITE_ALIGO_SENDER as string | undefined;
  cached =
    apiKey && userId && sender
      ? new AligoSmsProvider(apiKey, userId, sender)
      : new ConsoleSmsProvider();
  return cached;
}
