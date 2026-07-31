import type { PreparedReviewInput } from "./schemas.js";

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
    REDACTED,
  ],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, REDACTED],
  [/\bAKIA[A-Z0-9]{16}\b/gu, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/giu, `Bearer ${REDACTED}`],
];

export function redactText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  redacted = redacted.replace(
    /(["']?)([A-Za-z][A-Za-z0-9_]*)(["']?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gu,
    (assignment, openingQuote: string, key: string, closingQuote: string) => {
      const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toUpperCase();
      const keyParts = normalized.split("_");
      const sensitive =
        keyParts.some((part) => part === "SECRET" || part === "TOKEN" || part === "PASSWORD") ||
        normalized.includes("API_KEY") ||
        normalized.includes("APP_KEY") ||
        normalized.includes("ACCESS_KEY");
      return sensitive ? `${openingQuote}${key}${closingQuote}=${REDACTED}` : assignment;
    },
  );
  return redacted;
}

export function containsRecognizableSecret(value: string): boolean {
  return redactText(value) !== value;
}

export function redactPreparedInput(input: PreparedReviewInput): PreparedReviewInput {
  return {
    prUrl: input.prUrl,
    summary: redactText(input.summary),
    findings: input.findings.map((finding) => ({
      ...finding,
      issue: redactText(finding.issue),
      evidence: redactText(finding.evidence),
      ...(finding.proposedFix ? { proposedFix: redactText(finding.proposedFix) } : {}),
      diffHunk: redactText(finding.diffHunk),
    })),
    strengths: input.strengths.map((strength) => ({
      strength: redactText(strength.strength),
      evidence: redactText(strength.evidence),
    })),
  };
}

export function safeErrorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}
