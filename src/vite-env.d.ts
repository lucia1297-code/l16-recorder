/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADMIN_PASSWORD?: string;
  readonly VITE_ADMIN_PHONE?: string;
  readonly VITE_ALIGO_API_KEY?: string;
  readonly VITE_ALIGO_USER_ID?: string;
  readonly VITE_ALIGO_SENDER?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
