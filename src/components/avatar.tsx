import { UserRound } from "lucide-react";
import { useState } from "react";
import { avatarUrl } from "@/lib/contributors";
import { cn } from "@/components/ui";

/**
 * The bookbinding colours the generated book covers use (book-cover.tsx), so a reader without a
 * picture gets a cloth of their own, stable for their id, and a page of readers does not read as
 * one flat tint.
 */
const CLOTHS: ReadonlyArray<readonly [string, string]> = [
  ["#2f6b57", "#1b4033"],
  ["#b85c38", "#76381f"],
  ["#35507a", "#1d2c47"],
  ["#7a4a6b", "#472840"],
  ["#b8872b", "#7d5512"],
  ["#2f7f86", "#1a4c52"],
  ["#8a5a3c", "#522f1e"],
  ["#5f8a68", "#3b5e45"],
];

function clothOf(id: string): readonly [string, string] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return CLOTHS[(h >>> 0) % CLOTHS.length] ?? CLOTHS[0]!;
}

/**
 * A reader's round avatar: their uploaded picture from the books host, or the first letter of their
 * nickname on their own bookbinding cloth when there is none (or it fails to load), or a person icon when they have
 * no nickname. Decorative: the name is shown next to it.
 */
export function Avatar({
  id,
  name,
  version,
  size = 20,
  className,
  eager = false,
}: {
  id: string;
  name: string;
  version?: number;
  size?: number;
  className?: string;
  /** Load at once. The word card's picture is on screen as soon as the card opens. */
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const src = broken ? "" : avatarUrl(id, version);
  const letter = [...name.trim()][0]?.toUpperCase() ?? "";
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={box}
        className={cn("shrink-0 rounded-full bg-line object-cover", className)}
        onError={() => setBroken(true)}
        data-avatar={id}
      />
    );
  }
  const [from, to] = clothOf(id);
  return (
    <span
      aria-hidden
      style={{
        ...box,
        fontSize: Math.max(10, Math.round(size * 0.46)),
        backgroundImage: `linear-gradient(145deg, ${from}, ${to})`,
      }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-display font-semibold text-white/95 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]",
        className,
      )}
      data-avatar={id}
    >
      {letter || <UserRound style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={1.75} />}
    </span>
  );
}
