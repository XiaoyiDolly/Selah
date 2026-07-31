import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";
import { parsePullRequestUrl } from "../src/github.js";
import { MAX_TOTAL_DIFF_CHARS, PreparedReviewInputSchema } from "../src/schemas.js";
import { makeInput, PR_URL } from "./fixtures.js";

describe("PreparedReviewInputSchema", () => {
  it("accepts the bounded review contract", () => {
    expect(PreparedReviewInputSchema.parse(makeInput()).prUrl).toBe(PR_URL);
  });

  it("rejects more than five findings and unknown fields", () => {
    const finding = makeInput().findings[0];
    expect(
      PreparedReviewInputSchema.safeParse({
        ...makeInput(),
        findings: Array.from({ length: 6 }, () => finding),
      }).success,
    ).toBe(false);
    expect(PreparedReviewInputSchema.safeParse({ ...makeInput(), privateReflection: "no" }).success).toBe(false);
  });

  it("rejects unsafe paths and aggregate diff overflow", () => {
    const baseFinding = makeInput().findings[0];
    expect(
      PreparedReviewInputSchema.safeParse({
        ...makeInput(),
        findings: [{ ...baseFinding, path: "../secrets" }],
      }).success,
    ).toBe(false);

    const chunk = `+${"x".repeat(MAX_TOTAL_DIFF_CHARS / 3)}`;
    expect(
      PreparedReviewInputSchema.safeParse({
        ...makeInput(),
        findings: Array.from({ length: 4 }, (_, index) => ({
          ...baseFinding,
          path: `src/file-${index}.ts`,
          diffHunk: chunk,
        })),
      }).success,
    ).toBe(false);
  });
});

describe("PR URL validation", () => {
  it("canonicalizes a safe GitHub PR URL", () => {
    expect(parsePullRequestUrl(`${PR_URL}/`)).toEqual({
      owner: "example",
      name: "project",
      pullNumber: 123,
      url: PR_URL,
    });
  });

  it.each([
    "http://github.com/example/project/pull/1",
    "https://evil.example/example/project/pull/1",
    "https://github.com/example/project/pull/1?body=secret",
    "https://user:pass@github.com/example/project/pull/1",
    "https://github.com/example/project/issues/1",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => parsePullRequestUrl(url)).toThrow();
  });
});

describe("configuration approval gate", () => {
  it("enables YouVersion only for the exact value true", () => {
    expect(readConfig({ SELAH_YOUVERSION_AI_APPROVED: "true" }).youVersionAiApproved).toBe(true);
    expect(readConfig({ SELAH_YOUVERSION_AI_APPROVED: "TRUE" }).youVersionAiApproved).toBe(false);
    expect(readConfig({ SELAH_YOUVERSION_AI_APPROVED: "1" }).youVersionAiApproved).toBe(false);
  });
});
