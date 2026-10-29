import { useT } from "@/lib/i18n";
import { useFeedbackTip } from "@/lib/tutorial";
import { StepDialog } from "@/components/step-dialog";
import { ArtFeedbackHard, ArtFeedbackMissing } from "@/components/tutorial-art";

/**
 * After the reader's first word list is paired with their own EPUB, the book opens and this tip
 * shows once (src/lib/tutorial.ts): tell us when a meaning is still too hard, and when a hard word
 * is not marked, both from the word card's ? button (word-feedback.tsx), with or without the
 * reader's own meaning. Same frame as the tutorial (step-dialog.tsx).
 */
export default function FeedbackTipDialog() {
  const { t } = useT();
  const open = useFeedbackTip((state) => state.open);
  const hide = useFeedbackTip((state) => state.hide);
  return (
    <StepDialog
      name="feedback-tip"
      title={t("tip.title")}
      open={open}
      onClose={hide}
      finish={{ label: t("tip.done"), onClick: hide, data: "data-feedback-tip-done" }}
      steps={[
        {
          heading: t("tip.s1Title"),
          body: t("tip.s1Body"),
          art: (
            <ArtFeedbackHard
              label={t("tip.s1Title")}
              tooHard={t("card.feedbackTooHard")}
              addMine={t("card.feedbackAddMeaning")}
              thanks={t("tutorial.tagThanks")}
            />
          ),
        },
        {
          heading: t("tip.s2Title"),
          body: t("tip.s2Body"),
          art: (
            <ArtFeedbackMissing
              label={t("tip.s2Title")}
              missing={t("card.feedbackMissing")}
              addMine={t("card.feedbackAddMeaning")}
              thanks={t("tutorial.tagThanks")}
            />
          ),
        },
      ]}
    />
  );
}
