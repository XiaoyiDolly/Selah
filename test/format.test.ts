import { describe, expect, it } from "vitest";

import { formatPublicReview } from "../src/format.js";
import { makeGlooReview, makeInput } from "./fixtures.js";

describe("public review formatting", () => {
  it("uses original file metadata and validated public wording", () => {
    const review = formatPublicReview(makeInput(), makeGlooReview());
    expect(review.body).toContain("`src/importer.ts:42`");
    expect(review.body).toContain("Please avoid retrying authentication failures");
    expect(review.body).toContain("Authentication failures are retried");
    expect(review.body).toContain("The catch branch retries HTTP 401 and 403");
    expect(review.body).not.toContain("reflectionQuestion");
    expect(review.body).not.toContain("truth_and_grace");
  });

  it("retains deterministic technical substance even when provider wording drifts", () => {
    const review = formatPublicReview(
      makeInput(),
      makeGlooReview({ comments: [{ findingIndex: 0, wording: "No issue here.", encouragement: null }] }),
    );
    expect(review.body).toContain("No issue here");
    expect(review.body).toContain("Authentication failures are retried");
    expect(review.body).toContain("Retry only transient statuses");
  });

  it("rejects religious language from public provider fields", () => {
    expect(() =>
      formatPublicReview(
        makeInput(),
        makeGlooReview({ publicSummary: "Please pray about this change before merging." }),
      ),
    ).toThrow(/religious/i);
    expect(() =>
      formatPublicReview(makeInput(), makeGlooReview({ publicSummary: "Consider John 3:16 while reviewing." })),
    ).toThrow(/religious/i);
    expect(() =>
      formatPublicReview(makeInput(), makeGlooReview({ publicSummary: "Consider JAS.1.5 before merging." })),
    ).toThrow(/religious/i);
    expect(() =>
      formatPublicReview(makeInput(), makeGlooReview({ publicSummary: "This verse offers direction." })),
    ).toThrow(/religious/i);
  });

  it("rejects Scripture references generated in private formation", () => {
    expect(() =>
      formatPublicReview(
        makeInput(),
        makeGlooReview({
          privateFormation: {
            ...makeGlooReview().privateFormation,
            reflectionQuestion: "How does EPH.4.15 apply?",
          },
        }),
      ),
    ).toThrow(/Scripture/i);
  });

  it("fails closed if any validated provider field resembles a credential", () => {
    expect(() =>
      formatPublicReview(
        makeInput(),
        makeGlooReview({
          privateFormation: {
            ...makeGlooReview().privateFormation,
            toneReflection: "The provider echoed PASSWORD=hunter2",
          },
        }),
      ),
    ).toThrow(/credential|secret/i);
  });

  it("rejects omitted or invented finding and strength indexes", () => {
    expect(() => formatPublicReview(makeInput(), makeGlooReview({ comments: [] }))).toThrow(/one-to-one/i);
    expect(() =>
      formatPublicReview(makeInput(), makeGlooReview({ strengths: [{ strengthIndex: 2, wording: "Invented" }] })),
    ).toThrow(/one-to-one/i);
  });

  it("supports a no-findings review", () => {
    const input = makeInput({ findings: [], strengths: [] });
    const result = formatPublicReview(input, makeGlooReview({ comments: [], strengths: [] }));
    expect(result.body).toContain("No consequential issues");
  });
});
