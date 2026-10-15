/** How long a finger must stay on a shelf card's menu before that menu opens. */
export const SHELF_MENU_HOLD_MS = 450;

export type ShelfArm = "idle" | "wait" | "menu" | "scroll";

/** A press on the phone menu starts waiting. It is not a menu yet. */
export function shelfPressDown(): ShelfArm {
  return "wait";
}

/** A finger that slides is a scroll, not a tap and not a hold. */
export function shelfPressMove(arm: ShelfArm, distanceSq: number): ShelfArm {
  if ((arm === "wait" || arm === "menu") && distanceSq > 144) return "scroll";
  return arm;
}

/** The hold has lasted long enough. The menu opens when the finger lifts. */
export function shelfPressHeld(arm: ShelfArm): ShelfArm {
  return arm === "wait" ? "menu" : arm;
}

/** What releasing the phone menu does. */
export function shelfPressRelease(arm: ShelfArm): "menu" | "book" | "none" {
  if (arm === "menu") return "menu";
  if (arm === "wait") return "book";
  return "none";
}

/**
 * A tap on the reading page. On a phone the word card is a bottom sheet, and a
 * tap on the page — including another word — is how the reader puts it away.
 * A wider screen still switches to the word that was tapped.
 */
export function readingPageTap(input: { phone: boolean; cardOpen: boolean; hitWord: boolean }): "close" | "open" {
  if (!input.hitWord || (input.phone && input.cardOpen)) return "close";
  return "open";
}
