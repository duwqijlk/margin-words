/**
 * The day a glossary file last changed in git, as YYYY-MM-DD.
 * Discover shows this as the word list's last update. An uncommitted or
 * untracked file has no date.
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
      const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(out)) date = out;
    } catch {
      date = "";
    }
  }
  cache.set(file, date);
  return date;
}
