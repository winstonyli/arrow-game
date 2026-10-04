/** FNV-1a over the UTF-8 bytes of `s`. Returns a uint32. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local time zone

export const dailySeed = (mode: string, date = new Date()) => hashString(`${mode}:${day(date)}`);
export const dailyLabel = (date = new Date()) => `Daily ${day(date)}`;

/** A typed seed: small whole numbers are used as is, other text is hashed. Empty text gives null. */
export function customSeed(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d{1,10}$/.test(t) && Number(t) <= 0xffffffff) return Number(t);
  return hashString(t);
}
