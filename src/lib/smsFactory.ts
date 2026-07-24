import type { SmsProvider } from "./sms";
import { AligoSmsProvider } from "./sms.aligo";
import { SolapiSmsProvider } from "./sms.solapi";
import { ConsoleSmsProvider } from "./sms.console";

let cached: SmsProvider | null = null;

export function createSmsProvider(): SmsProvider {
  if (cached) return cached;

  const solapiKey = import.meta.env.VITE_SOLAPI_API_KEY as string | undefined;
  const solapiSecret = import.meta.env.VITE_SOLAPI_API_SECRET as string | undefined;
  const solapiSender = import.meta.env.VITE_SOLAPI_SENDER as string | undefined;
  if (solapiKey && solapiSecret && solapiSender) {
    cached = new SolapiSmsProvider(solapiKey, solapiSecret, solapiSender);
    return cached;
  }

  const aligoKey = import.meta.env.VITE_ALIGO_API_KEY as string | undefined;
  const aligoUserId = import.meta.env.VITE_ALIGO_USER_ID as string | undefined;
  const aligoSender = import.meta.env.VITE_ALIGO_SENDER as string | undefined;
  if (aligoKey && aligoUserId && aligoSender) {
    cached = new AligoSmsProvider(aligoKey, aligoUserId, aligoSender);
    return cached;
  }

  cached = new ConsoleSmsProvider();
  return cached;
}
