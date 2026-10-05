import { create } from "zustand";

export type AccountPhase = "unknown" | "out" | "in";
export type SyncStatus = "idle" | "saving" | "saved" | "offline" | "error";
export type AccountMode = "login" | "register" | "reset";

type AccountState = {
  phase: AccountPhase;
  email: string | null;
  /** Chosen label. Null until the reader saves one. Not unique. */
  nickname: string | null;
  /** Set only right after a new account is created, so the dialog asks for a nickname. */
  nicknamePrompt: boolean;
  sync: SyncStatus;
  dialogOpen: boolean;
  mode: AccountMode;
  resetToken: string;
  patch: (partial: Partial<Omit<AccountState, "patch" | "openDialog" | "closeDialog">>) => void;
  openDialog: (mode?: AccountMode, resetToken?: string) => void;
  closeDialog: () => void;
};

export const useAccount = create<AccountState>()((set) => ({
  phase: "unknown",
  email: null,
  nickname: null,
  nicknamePrompt: false,
  sync: "idle",
  dialogOpen: false,
  mode: "login",
  resetToken: "",
  patch: (partial) => set(partial),
  openDialog: (mode = "login", resetToken = "") =>
    set({ dialogOpen: true, mode, resetToken: resetToken || "" }),
  closeDialog: () => set({ dialogOpen: false, resetToken: "", nicknamePrompt: false }),
}));
