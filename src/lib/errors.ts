/**
 * Errors that the reader shows to the person using it. They carry a `code` so the screen can show
 * the message in the language the person chose (see src/lib/i18n.ts, keys "err.<code>").
 * `message` is always plain English, so the command-line tools can print it too.
 * No imports here: this file is also used by scripts/lib/app-modules.mjs.
 */
export type ErrorCode = "notValidEpub" | "drm" | "notEpub" | "noToc" | "noEnglishText";

export class CodedError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CodedError";
    this.code = code;
  }
}
