import { create } from "zustand";

export type AccountPhase = "unknown" | "out" | "in";
export type SyncStatus = "idle" | "saving" | "saved" | "offline" | "error";
export type AccountMode = "login" | "register" | "reset";

type AccountState = {
  phase: AccountPhase;
  email: string | null;
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
  sync: "idle",
  dialogOpen: false,
  mode: "login",
  resetToken: "",
  patch: (partial) => set(partial),
  openDialog: (mode = "login", resetToken = "") =>
    set({ dialogOpen: true, mode, resetToken: resetToken || "" }),
  closeDialog: () => set({ dialogOpen: false, resetToken: "" }),
}));
