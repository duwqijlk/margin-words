import { useState } from "react";
import { useAccount } from "@/lib/account-store";
import { isSponsorAdmin } from "@/lib/sponsor";
import { askToSignIn } from "@/lib/can-add";
import { signOut } from "@/lib/sync-engine";
import { useT } from "@/lib/i18n";
import { BooksAdmin } from "@/components/books-admin";
import { SponsorTab } from "@/components/sponsor-admin";
import { UsersAdmin } from "@/components/users-admin";
import { SeriesAdmin } from "@/components/series-admin";
import { QqGroupsAdmin } from "@/components/qq-groups-admin";
import { WordListAdmin } from "@/components/wordlist-admin";
import { WordTapsAdmin } from "@/components/word-taps-admin";
import { BlurbAdmin } from "@/components/blurb-admin";
import { btn, cn, Segmented } from "@/components/ui";

type AdminTab = "thanks" | "lists" | "books" | "blurbs" | "series" | "users" | "taps" | "qq";

/** The /admin page: gift requests, the word-list publisher, whole-book uploads, and user roles. */
export function AdminPage() {
  const { t } = useT();
  const phase = useAccount((state) => state.phase);
  const role = useAccount((state) => state.role);
  const email = useAccount((state) => state.email);
  const [tab, setTab] = useState<AdminTab>("thanks");
  const admin = phase === "in" && (role === "admin" || isSponsorAdmin(email));

  return (
    <div
      className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 sm:px-6 sm:py-10"
      data-admin-page
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-5">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {t("admin.title")}
          </h1>
          {admin ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-3 py-0.5 text-xs font-semibold text-accent shadow-2xs">
              <span className="size-1.5 rounded-full bg-accent" />
              Admin
            </span>
          ) : null}
        </div>
      </div>

      {phase === "unknown" ? (
        <p className="text-muted">{t("dashboard.loading")}</p>
      ) : !admin ? (
        <div className="grid justify-items-start gap-4 rounded-2xl border border-line/80 bg-card p-6 shadow-sm">
          <p className="text-base text-muted">{t("admin.only")}</p>
          {email ? (
            <p className="text-sm text-muted">
              {t("admin.signedInAs", { email })}
            </p>
          ) : null}
          <button
            type="button"
            className={btn.primary}
            onClick={() => {
              if (phase === "in") {
                void signOut().finally(() => {
                  useAccount.getState().openDialog("login");
                });
              } else {
                askToSignIn();
              }
            }}
          >
            {phase === "in" ? t("admin.switchAccount") : t("admin.signIn")}
          </button>
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label={t("admin.title")}
            className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line/60 bg-line/35 p-1.5 backdrop-blur-xs sm:flex-nowrap"
          >
            {[
              { value: "thanks" as const, label: t("admin.tab.thanks") },
              { value: "lists" as const, label: t("admin.tab.lists") },
              { value: "taps" as const, label: t("admin.tab.taps") },
              { value: "books" as const, label: t("admin.tab.books") },
              { value: "blurbs" as const, label: t("admin.tab.blurbs") },
              { value: "series" as const, label: t("admin.tab.series") },
              { value: "users" as const, label: t("admin.tab.users") },
              { value: "qq" as const, label: t("admin.tab.qq") },
            ].map((option) => {
              const active = tab === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  data-admin-tab={option.value}
                  aria-pressed={active}
                  onClick={() => setTab(option.value)}
                  className={cn(
                    "min-h-10 flex-1 whitespace-nowrap rounded-xl px-3.5 text-sm font-semibold transition-all duration-150 active:scale-98",
                    active
                      ? "border border-line/60 bg-card text-ink shadow-xs"
                      : "text-muted hover:text-ink hover:bg-card/40",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="min-w-0">
            {tab === "thanks" ? (
              <SponsorTab />
            ) : tab === "lists" ? (
              <WordListAdmin />
            ) : tab === "taps" ? (
              <WordTapsAdmin />
            ) : tab === "books" ? (
              <BooksAdmin />
            ) : tab === "blurbs" ? (
              <BlurbAdmin />
            ) : tab === "series" ? (
              <SeriesAdmin />
            ) : tab === "qq" ? (
              <QqGroupsAdmin />
            ) : (
              <UsersAdmin />
            )}
          </div>
        </>
      )}
    </div>
  );
}
