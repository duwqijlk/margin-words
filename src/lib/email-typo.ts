/**
 * "Did you mean …?" for an email address whose domain is a common typing slip of a well-known
 * mail host (gamil.com -> gmail.com). Only suggests; it never changes what the reader typed, and
 * a domain that is not close to a known one gets no suggestion.
 */

/** Mail hosts readers use, most common first. A slip is matched against these only. */
const KNOWN = [
  "gmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "yahoo.com",
  "foxmail.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "aliyun.com",
  "live.com",
  "msn.com",
  "me.com",
  "yeah.net",
  "139.com",
  "proton.me",
  "protonmail.com",
] as const;

/** Slips seen often enough to fix even when the distance rule would not reach them. */
const FIXES: Record<string, string> = {
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.cn": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com",
  "qq.co": "qq.com",
  "qq.cn": "qq.com",
  "qq.con": "qq.com",
  "163.co": "163.com",
  "163.cn": "163.com",
  "126.co": "126.com",
  "126.cn": "126.com",
  "hotmail.co": "hotmail.com",
  "outlook.co": "outlook.com",
  "icloud.co": "icloud.com",
};

/**
 * Edit distance with a swap of two neighbours counting as one step (optimal string alignment).
 * Small inputs only (domains), so the plain table is fine.
 */
export function slipDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The address with its domain corrected, or "" when the domain looks right. `reader@gamil.com`
 * gives `reader@gmail.com`; `reader@company.com` gives "" (not close to any known host).
 */
export function suggestEmail(value: string): string {
  const address = value.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return "";
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if ((KNOWN as readonly string[]).includes(domain)) return "";
  const fixed = FIXES[domain];
  if (fixed) return `${local}@${fixed}`;
  let best = "";
  let bestDistance = Infinity;
  for (const host of KNOWN) {
    // Only hosts of a similar length: "gmail.com" is not a slip of "mail.ru".
    if (Math.abs(host.length - domain.length) > 2) continue;
    const distance = slipDistance(domain, host);
    if (distance < bestDistance) {
      best = host;
      bestDistance = distance;
    }
  }
  // One or two slips in a domain of 7+ letters; one in a short one (qq.com, 163.com).
  const limit = domain.length >= 7 ? 2 : 1;
  return best && bestDistance > 0 && bestDistance <= limit ? `${local}@${best}` : "";
}
