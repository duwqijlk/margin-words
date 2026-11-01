import { Coffee } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { SponsorDialog } from "@/components/sponsor-dialog";

/** A desktop-only sponsor shortcut in the margin; never over the reading page. */
export function SponsorTab() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="fixed top-[58%] right-0 z-40 hidden size-12 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-float-edge bg-float text-accent shadow-hero hover:bg-sheet min-[1185px]:inline-flex"
        aria-label={t("dashboard.sponsorProject")}
        title={t("dashboard.sponsorProject")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-sponsor-tab
      >
        <Coffee className="size-6" strokeWidth={1.5} aria-hidden />
      </button>
      <SponsorDialog open={open} onOpenChange={setOpen} onSubmitted={() => undefined} />
    </>
  );
}
