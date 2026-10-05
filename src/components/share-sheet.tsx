import * as Dialog from "@radix-ui/react-dialog";
import { Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account-store";
import { useT } from "@/lib/i18n";
import { renderShareCard, SHARE_SITE, shareDateParts } from "@/lib/share-card";
import { btn, cn } from "@/components/ui";

type Picture = { url: string; blob: Blob };

/** Phone-sized share picture: nickname, words learned, today's month and day, and the site name. */
export function ShareSheet({ count }: { count: number }) {
  const { t, locale } = useT();
  const nickname = useAccount((state) => state.nickname);
  const [open, setOpen] = useState(false);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    return () => {
      if (picture) URL.revokeObjectURL(picture.url);
    };
  }, [picture]);

  async function openShare() {
    setProblem("");
    setOpen(true);
    const parts = shareDateParts(new Date(), locale);
    const name = nickname?.trim() || t("share.noName");
    const dateLabel = t("share.date", parts);
    try {
      const blob = await renderShareCard({
        nickname: name,
        wordsLabel: t("share.words"),
        dateLabel,
        count,
      });
      const url = URL.createObjectURL(blob);
      setPicture({ url, blob });
    } catch {
      setPicture(null);
      setProblem(t("share.failed"));
    }
  }

  function download() {
    if (!picture) return;
    const link = document.createElement("a");
    link.href = picture.url;
    link.download = "inputread.png";
    link.click();
  }

  async function systemShare() {
    if (!picture || typeof navigator.share !== "function") return;
    const file = new File([picture.blob], "inputread.png", { type: "image/png" });
    try {
      const payload = { files: [file], title: SHARE_SITE };
      if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
        download();
        return;
      }
      await navigator.share(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      download();
    }
  }

  const parts = shareDateParts(new Date(), locale);
  const name = nickname?.trim() || t("share.noName");
  const dateLabel = t("share.date", parts);
  const canSystemShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <button type="button" className={cn(btn.quiet, "w-full sm:w-auto")} onClick={() => void openShare()} data-notebook-share>
        <Share2 className="size-4" aria-hidden />
        {t("nb.share")}
      </button>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setProblem("");
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
          <Dialog.Content
            className="anim-pop fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border border-line bg-card p-5 text-ink shadow-pop"
            data-share-sheet
          >
            <div className="flex items-start justify-between gap-3">
              <Dialog.Title className="font-display text-2xl font-semibold">{t("share.title")}</Dialog.Title>
              <Dialog.Close className={cn(btn.icon, "-mt-1 -mr-2")} aria-label={t("common.close")}>
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-sm text-muted">{t("share.hint")}</Dialog.Description>
            {picture ? (
              <img
                src={picture.url}
                alt={t("share.alt", { name, n: count, date: dateLabel })}
                width={360}
                height={640}
                className="mx-auto h-auto w-[min(16rem,72vw)] rounded-2xl border border-line"
                data-share-image
              />
            ) : problem ? null : (
              <p className="py-8 text-center text-sm text-muted">{t("account.working")}</p>
            )}
            {problem ? (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
                {problem}
              </p>
            ) : null}
            {!nickname ? <p className="text-xs text-muted">{t("share.needName")}</p> : null}
            <div className="grid gap-2">
              <button type="button" className={btn.primary} disabled={!picture} onClick={download} data-share-save>
                {t("share.save")}
              </button>
              {canSystemShare ? (
                <button type="button" className={btn.quiet} disabled={!picture} onClick={() => void systemShare()} data-share-system>
                  {t("share.system")}
                </button>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
