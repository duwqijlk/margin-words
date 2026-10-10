/** Minimal D1 surface the handlers use. Tests pass a node:sqlite adapter with the same shape. */

export type D1Result<T> = { results: T[] };

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

/** Minimal R2 surface the admin handlers use. */
export interface R2ObjectLike {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  size: number;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>;
}

export type Env = {
  DB: D1Database;
  /** Public books bucket (word-list catalogs, glossaries, covers). Optional in tests. */
  BOOKS?: R2BucketLike;
  /** Private copyrighted-EPUB bucket. Never exposed without a trusted account. */
  PRIVATE?: R2BucketLike;
  /** When set, register requires a Turnstile token. Unset means the check is off. */
  TURNSTILE_SECRET_KEY?: string;
  /** When set, password-reset requests send mail through Resend. Unset keeps the hook off. */
  RESEND_API_KEY?: string;
};

export type UserRole = "user" | "trusted" | "admin";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iters: number;
  created_at: number;
  /** Empty when the reader has not chosen one. Not unique. */
  nickname: string | null;
  /** "admin" is the owner account; "trusted" may open private-library EPUBs. */
  role: UserRole;
};

export type SyncRow = {
  kind: string;
  item_id: string;
  data: string;
  updated_at: number;
  deleted: number;
};
