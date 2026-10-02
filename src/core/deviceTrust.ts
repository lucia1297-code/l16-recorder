// "Remember this device": keeps admin access for a limited time.
// Stores only an expiry timestamp in localStorage, never the password or code.
export const TRUST_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function rememberDevice(store: StorageLike, key: string, now: number = Date.now(), days: number = TRUST_DAYS): void {
  try {
    store.setItem(key, String(now + days * DAY_MS));
  } catch {
    // storage unavailable: fall back to entering the code every time
  }
}

export function isDeviceRemembered(store: StorageLike, key: string, now: number = Date.now()): boolean {
  try {
    const raw = store.getItem(key);
    if (!raw) return false;
    const expires = Number(raw);
    if (!Number.isFinite(expires) || expires <= now) {
      store.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function forgetDevice(store: StorageLike, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}