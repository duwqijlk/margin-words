/**
 * When a glossary file last changed in git, as an ISO instant (`2026-10-07T01:17:00+08:00`).
 * Discover shows that clock time in the reader's own time zone. An uncommitted or
 * untracked file has no time.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cache = new Map();

export function committedOn(file) {
  if (cache.has(file)) return cache.get(file);
  let date = "";
  if (existsSync(file)) {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(out)) date = out;
    } catch {
      date = "";
    }
  }
  cache.set(file, date);
  return date;
}
