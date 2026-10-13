/**
 * Largest glossary the admin upload accepts, in characters for a raw body and
 * in bytes for a multipart file. The reader uses the same number
 * (`LIMITS.bytes` in src/lib/glossary-format.ts).
 */
export const GLOSSARY_MAX = 16_000_000;
