export type SelahErrorCode =
  | "CONFIG_INVALID"
  | "DRAFT_EXPIRED"
  | "DRAFT_INSECURE"
  | "DRAFT_INVALID"
  | "DRAFT_NOT_FOUND"
  | "GITHUB_AUTH"
  | "GITHUB_POST"
  | "GITHUB_POST_UNCERTAIN"
  | "INPUT_INVALID"
  | "PROVIDER_AUTH"
  | "PROVIDER_MALFORMED"
  | "PROVIDER_UNAVAILABLE"
  | "PUBLIC_CONTENT_UNSAFE";

export class SelahError extends Error {
  readonly code: SelahErrorCode;
  readonly exitCode: number;

  constructor(code: SelahErrorCode, message: string, options?: { cause?: unknown; exitCode?: number }) {
    super(message, { cause: options?.cause });
    this.name = "SelahError";
    this.code = code;
    this.exitCode = options?.exitCode ?? 1;
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
