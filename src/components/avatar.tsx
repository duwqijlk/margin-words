import { UserRound } from "lucide-react";
import { useState } from "react";
import { avatarUrl } from "@/lib/contributors";
import { cn } from "@/components/ui";

/**
 * A reader's round avatar: their uploaded picture from the books host, or the first letter of their
 * nickname on a quiet tint when there is none (or it fails to load), or a person icon when they have
 * no nickname. Decorative: the name is shown next to it.
 */
export function Avatar({
  id,
  name,
  version,
  size = 20,
  className,
}: {
  id: string;
  name: string;
  version?: number;
  size?: number;
  className?: string;
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
        loading="lazy"
        decoding="async"
        style={box}
        className={cn("shrink-0 rounded-full bg-line object-cover", className)}
        onError={() => setBroken(true)}
        data-avatar={id}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.5)) }}
      className={cn("inline-grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent", className)}
      data-avatar={id}
    >
      {letter || <UserRound style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={1.75} />}
    </span>
  );
}
