import { useState } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT } from "@/lib/i18n";
import { SponsorTab } from "@/components/sponsor-admin";
import { UsersAdmin } from "@/components/users-admin";
import { WordListAdmin } from "@/components/wordlist-admin";
import { btn, Segmented } from "@/components/ui";

type AdminTab = "thanks" | "lists" | "users";

/** The /admin page: gift requests, the word-list publisher, and user roles. */
export function AdminPage() {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const role = useAccount((state) => state.role);
  const [tab, setTab] = useState<AdminTab>("thanks");
  const admin = phase === "in" && role === "admin";

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-6 sm:py-10" data-admin-page>
      <h1 className="font-display text-3xl font-semibold">{t("admin.title")}</h1>
      {phase === "unknown" ? (
        <p>{t("dashboard.loading")}</p>
      ) : !admin ? (
        <div className="grid justify-items-start gap-3">
          <p>{t("admin.only")}</p>
          {!phase || phase !== "in" ? (
            <button type="button" className={btn.primary} onClick={() => askToSignIn()}>
              {t("admin.signIn")}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <Segmented
            label={t("admin.title")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "thanks" as const, label: t("admin.tab.thanks") },
              { value: "lists" as const, label: t("admin.tab.lists") },
              { value: "users" as const, label: t("admin.tab.users") },
            ]}
          />
          {tab === "thanks" ? <SponsorTab /> : tab === "lists" ? <WordListAdmin /> : <UsersAdmin />}
        </>
      )}
    </div>
  );
}
