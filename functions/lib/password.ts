/** PBKDF2-SHA256 password hashing. WebCrypto, so it runs in Workers and in Node tests. */

export const PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. Length differences still fail closed. */
export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(
  password: string,
  salt?: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes as BufferSource, iterations },
    key,
    HASH_BITS,
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(saltBytes),
    iterations,
  };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  iterations: number,
): Promise<boolean> {
  const next = await hashPassword(password, base64ToBytes(salt), iterations);
  return safeEqual(next.hash, hash);
}
