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
}

export type Env = {
  DB: D1Database;
  /** When set, register requires a Turnstile token. Unset means the check is off. */
  TURNSTILE_SECRET_KEY?: string;
};

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iters: number;
  created_at: number;
  /** Empty when the reader has not chosen one. Not unique. */
  nickname: string | null;
};

export type SyncRow = {
  kind: string;
  item_id: string;
  data: string;
  updated_at: number;
  deleted: number;
};
