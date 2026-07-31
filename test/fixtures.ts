import type { GlooReview, PreparedReviewInput, RepositoryRef } from "../src/schemas.js";

export const PR_URL = "https://github.com/example/project/pull/123";

export const REPOSITORY: RepositoryRef = {
  owner: "example",
  name: "project",
  pullNumber: 123,
  url: PR_URL,
};

export function makeInput(overrides: Partial<PreparedReviewInput> = {}): PreparedReviewInput {
  return {
    prUrl: PR_URL,
    summary: "The change adds bounded retry handling.",
    findings: [
      {
        path: "src/importer.ts",
        line: 42,
        severity: "important",
        issue: "Authentication failures are retried.",
        evidence: "The catch branch retries HTTP 401 and 403.",
        proposedFix: "Retry only transient statuses.",
        diffHunk: "@@ -40,2 +40,4 @@\n+return retry(request);",
      },
    ],
    strengths: [
      {
        strength: "The retry count is bounded.",
        evidence: "The loop stops after three attempts.",
      },
    ],
    ...overrides,
  };
}

export function makeGlooReview(overrides: Partial<GlooReview> = {}): GlooReview {
  return {
    publicSummary: "The implementation is focused, with one reliability concern to address.",
    comments: [
      {
        findingIndex: 0,
        wording: "Please avoid retrying authentication failures because they cannot recover without new credentials.",
        encouragement: "The bounded attempt count keeps transient failures predictable.",
      },
    ],
    strengths: [{ strengthIndex: 0, wording: "The retry loop has a clear upper bound." }],
    privateFormation: {
      toneReflection: "Lead with the observable behavior before suggesting the change.",
      reflectionQuestion: "How can the comment make the next action easy to understand?",
      theme: "truth_and_grace",
    },
    ...overrides,
  };
}

export function completionEnvelope(review: GlooReview = makeGlooReview()): unknown {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                name: "submit_selah_review",
                arguments: JSON.stringify(review),
              },
            },
          ],
        },
      },
    ],
  };
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
