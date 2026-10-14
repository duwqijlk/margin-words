import { useEffect, useState } from "react";
import { btn, cn, field } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { DEFAULT_QQ_GROUPS, normalizeQqGroups, QQ_GROUP_LIMIT } from "@/lib/qq-groups";

const NUMBER = /^\d{5,12}$/;

/** Admin list of the QQ group numbers on the overview. */
export function QqGroupsAdmin() {
  const { t } = useT();
  const [groups, setGroups] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/qq-groups", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<{ saved?: unknown; groups?: unknown }>;
      })
      .then((body) => {
        if (!alive) return;
        if (body.saved === true) {
          const parsed = normalizeQqGroups(body);
          if (!parsed.ok) throw new Error("load");
          setGroups(parsed.groups);
          setSaved(true);
          return;
        }
        setGroups([...DEFAULT_QQ_GROUPS]);
        setSaved(false);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function add() {
    const value = number.trim();
    if (!NUMBER.test(value) || (groups?.length ?? 0) >= QQ_GROUP_LIMIT) {
      setError(t("admin.qq.bad"));
      return;
    }
    if (groups?.includes(value)) {
      setError(t("admin.qq.duplicate"));
      return;
    }
    setGroups([...(groups ?? []), value]);
    setNumber("");
    setError("");
    setNote("");
  }

  function remove(value: string) {
    setGroups((current) => (current ?? []).filter((item) => item !== value));
    setNote("");
  }

  async function save() {
    if (!groups || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch("/api/admin/qq-groups", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      if (!response.ok) throw new Error("save");
      const parsed = normalizeQqGroups(await response.json());
      if (!parsed.ok) throw new Error("save");
      setGroups(parsed.groups);
      setSaved(true);
      setNote(t("admin.qq.saved"));
    } catch {
      setError(t("admin.qq.error"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <p role="alert">{t("admin.qq.error")}</p>;
  if (!groups) return <p>{t("dashboard.loading")}</p>;

  return (
    <div className="grid gap-4" data-admin-qq>
      <p className="text-sm text-muted">{t("admin.qq.hint")}</p>
      {saved ? null : <p className="text-sm text-muted">{t("admin.qq.unsaved", { number: DEFAULT_QQ_GROUPS[0] })}</p>}
      {groups.length === 0 ? <p className="text-sm text-muted">{t("admin.qq.empty")}</p> : null}
      <ul className="grid gap-2">
        {groups.map((item) => (
          <li key={item} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2" data-admin-qq-row={item}>
            <span className="font-mono tabular-nums">{item}</span>
            <button type="button" className={cn(btn.quiet, "min-h-9 px-3 text-sm")} onClick={() => remove(item)} data-admin-qq-remove={item}>
              {t("admin.qq.remove")}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1 text-sm font-medium">
          {t("admin.qq.number")}
          <input
            className={field}
            value={number}
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => setNumber(event.target.value)}
            data-admin-qq-number
          />
        </label>
        <button type="submit" className={cn(btn.quiet, "mt-6")} data-admin-qq-add>
          {t("admin.qq.add")}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="text-sm text-accent">{note}</p> : null}
      <button type="button" className={cn(btn.primary, "justify-start")} disabled={busy} onClick={() => void save()} data-admin-qq-save>
        {busy ? t("account.working") : t("admin.qq.save")}
      </button>
    </div>
  );
}
