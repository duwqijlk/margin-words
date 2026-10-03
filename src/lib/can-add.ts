/**
 * Who may put new books on the shelf: only a signed-in reader. Signed-out visitors can still
 * browse Discover, the Guide and About, and books already stored on this device stay readable.
 * Every "add / download / import my e-book" action checks this ONE helper; the button then says
 * "Sign in to add" and opens the normal sign-in dialog.
 */
import { useAccount, type AccountPhase } from "@/lib/account-store";

/** May this visitor add books? True only when signed in ("unknown" counts as signed out). */
export function canAddBooks(phase: AccountPhase): boolean {
  return phase === "in";
}

/** The same answer as a hook, so buttons re-render when the reader signs in or out. */
export function useCanAddBooks(): boolean {
  return useAccount((state) => canAddBooks(state.phase));
}

/** Open the sign-in dialog (the existing account flow) for a visitor who tried to add a book. */
export function askToSignIn(): void {
  useAccount.getState().openDialog("login");
}
