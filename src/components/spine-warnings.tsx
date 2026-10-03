import type { SpineNameWarning } from "@/lib/epub";
import { useT } from "@/lib/i18n";

const SPINE_WARNING_KEY = {
  key: "plan.spineKey",
  target: "plan.spineTarget",
  idle: "plan.spineIdle",
} as const;

/** spine.merge warnings from an import, in the reader's language. */
export function SpineWarningList({ warnings }: { warnings: SpineNameWarning[] }) {
  const { t } = useT();
  if (warnings.length === 0) return null;
  return (
    <ul className="grid list-disc gap-1 pl-4" data-spine-warning>
      {warnings.map((warning) => (
        <li key={`${warning.kind}:${warning.name}`}>
          {t(SPINE_WARNING_KEY[warning.kind], { name: warning.name })}
        </li>
      ))}
    </ul>
  );
}
