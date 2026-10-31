import { create } from "zustand";

/**
 * Focus mode (design system ReviewSession): while a review round runs, the site chrome (the top
 * bar with its tabs and icons, the phone tab bar, the notices) steps aside. Only the round's own
 * "End" button, its count and its progress line stay. Set by the round while it is mounted.
 */
export const useFocusMode = create<{ on: boolean }>(() => ({ on: false }));

/** Turn focus mode on for as long as the caller is mounted. Returns the cleanup for an effect. */
export function holdFocusMode(): () => void {
  useFocusMode.setState({ on: true });
  return () => useFocusMode.setState({ on: false });
}
