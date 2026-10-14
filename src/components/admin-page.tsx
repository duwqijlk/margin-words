import { useState } from "react";
import { useAccount } from "@/lib/account-store";
import { askToSignIn } from "@/lib/can-add";
import { useT } from "@/lib/i18n";
import { BooksAdmin } from "@/components/books-admin";
import { SponsorTab } from "@/components/sponsor-admin";
import { UsersAdmin } from "@/components/users-admin";
import { SeriesAdmin } from "@/components/series-admin";
import { QqGroupsAdmin } from "@/components/qq-groups-admin";
import { WordListAdmin } from "@/components/wordlist-admin";
import { btn, cn, Segmented } from "@/components/ui";

type AdminTab = "thanks" | "lists" | "books" | "series" | "users" | "qq";

/** The /admin page: gift requests, the word-list publisher, whole-book uploads, and user roles. */
export function AdminPage() {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const role = useAccount((state) => state.role);
  const [tab, setTab] = useState<AdminTab>("thanks");
  const admin = phase === "in" && role === "admin";

  return (
    <div
      className={cn(
        "mx-auto grid w-full gap-4 px-4 py-6 sm:px-6 sm:py-10",
        admin && tab === "lists" ? "max-w-6xl" : "max-w-3xl",
      )}
      data-admin-page
    >
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
            layout="wrap"
            options={[
              { value: "thanks" as const, label: t("admin.tab.thanks") },
              { value: "lists" as const, label: t("admin.tab.lists") },
              { value: "books" as const, label: t("admin.tab.books") },
              { value: "series" as const, label: t("admin.tab.series") },
              { value: "users" as const, label: t("admin.tab.users") },
              { value: "qq" as const, label: t("admin.tab.qq") },
            ]}
          />
          {tab === "thanks" ? (
            <SponsorTab />
          ) : tab === "lists" ? (
            <WordListAdmin />
          ) : tab === "books" ? (
            <BooksAdmin />
          ) : tab === "series" ? (
            <SeriesAdmin />
          ) : tab === "qq" ? (
            <QqGroupsAdmin />
          ) : (
            <UsersAdmin />
          )}
        </>
      )}
    </div>
  );
}
