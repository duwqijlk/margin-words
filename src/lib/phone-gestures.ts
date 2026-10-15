/** How long a phone menu stays ready for its second tap. */
export const SHELF_MENU_ARM_MS = 2500;

export type ShelfArm = "idle" | "wait" | "armed" | "scroll";

/**
 * A press on the phone menu. The first press only gets ready.
 * A second press, while that ready state lasts, can open the menu.
 * A long press is not used: on a phone that gesture selects text.
 */
export function shelfPressDown(arm: ShelfArm): ShelfArm {
  return arm === "armed" ? "armed" : "wait";
}

/** A finger that slides is a scroll, not either tap. */
export function shelfPressMove(arm: ShelfArm, distanceSq: number): ShelfArm {
  if ((arm === "wait" || arm === "armed") && distanceSq > 144) return "scroll";
  return arm;
}

/** What lifting the finger does. The first tap arms. The second tap opens. */
export function shelfPressRelease(arm: ShelfArm): "menu" | "arm" | "none" {
  if (arm === "armed") return "menu";
  if (arm === "wait") return "arm";
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
