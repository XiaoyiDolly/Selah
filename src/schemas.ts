import { z } from "zod";

export const MAX_INPUT_FILE_BYTES = 96 * 1024;
export const MAX_TOTAL_DIFF_CHARS = 40_000;
export const MAX_PUBLIC_REVIEW_CHARS = 30_000;

export const SeveritySchema = z.enum(["blocking", "important", "suggestion"]);
export const ReflectionThemeSchema = z.enum([
  "truth_and_grace",
  "humility",
  "patience",
  "encouragement",
  "wisdom",
]);

const BoundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const DiffHunkSchema = z
  .string()
  .min(1)
  .max(16_000)
  .refine((value) => value.trim().length > 0, "Diff hunk cannot be blank")
  .refine((value) => !value.includes("\0"), "Diff hunk cannot contain NUL bytes");

function isSafeRepositoryPath(value: string): boolean {
  if (
    value.startsWith("/") ||
    value.startsWith("-") ||
    value.includes("\\") ||
    /[\0\r\n`]/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const FindingSchema = z
  .object({
    path: z.string().min(1).max(512).refine(isSafeRepositoryPath, "Unsafe repository path"),
    line: z.number().int().positive().max(10_000_000).optional(),
    severity: SeveritySchema,
    issue: BoundedText(2_000),
    evidence: BoundedText(3_000),
    proposedFix: BoundedText(2_000).optional(),
    diffHunk: DiffHunkSchema,
  })
  .strict();

export const StrengthSchema = z
  .object({
    strength: BoundedText(1_000),
    evidence: BoundedText(2_000),
  })
  .strict();

export const PreparedReviewInputSchema = z
  .object({
    prUrl: z.string().url().max(2_048),
    summary: BoundedText(4_000),
    findings: z.array(FindingSchema).max(5),
    strengths: z.array(StrengthSchema).max(3),
  })
  .strict()
  .superRefine((input, context) => {
    const totalDiffLength = input.findings.reduce((total, finding) => total + finding.diffHunk.length, 0);
    if (totalDiffLength > MAX_TOTAL_DIFF_CHARS) {
      context.addIssue({
        code: "custom",
        message: `Combined diff hunks cannot exceed ${MAX_TOTAL_DIFF_CHARS} characters`,
        path: ["findings"],
      });
    }
  });

export type PreparedReviewInput = z.infer<typeof PreparedReviewInputSchema>;

export const GlooReviewSchema = z
  .object({
    publicSummary: BoundedText(4_000),
    comments: z
      .array(
        z
          .object({
            findingIndex: z.number().int().nonnegative().max(4),
            wording: BoundedText(4_000),
            encouragement: BoundedText(1_000).nullable(),
          })
          .strict(),
      )
      .max(5),
    strengths: z
      .array(
        z
          .object({
            strengthIndex: z.number().int().nonnegative().max(2),
            wording: BoundedText(2_000),
          })
          .strict(),
      )
      .max(3),
    privateFormation: z
      .object({
        toneReflection: BoundedText(2_000),
        reflectionQuestion: BoundedText(1_000),
        theme: ReflectionThemeSchema,
      })
      .strict(),
  })
  .strict();

export type GlooReview = z.infer<typeof GlooReviewSchema>;
export type ReflectionTheme = z.infer<typeof ReflectionThemeSchema>;

export const RepositoryRefSchema = z
  .object({
    owner: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    pullNumber: z.number().int().positive(),
    url: z.string().url(),
  })
  .strict();

export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;

export const PublicReviewSchema = z
  .object({
    body: z.string().min(1).max(MAX_PUBLIC_REVIEW_CHARS),
  })
  .strict();

export type PublicReview = z.infer<typeof PublicReviewSchema>;

export const PrivateFormationSchema = GlooReviewSchema.shape.privateFormation;

export const ScriptureSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      passageId: z.string().min(1),
      reference: z.string().min(1),
      text: z.string().min(1),
      versionId: z.string().min(1),
      versionTitle: z.string().min(1),
      versionAbbreviation: z.string().min(1),
      copyright: z.string().min(1),
      attribution: z.string().min(1),
      youVersionUrl: z.string().url().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("disabled_pending_approval"),
      message: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      message: z.string().min(1),
    })
    .strict(),
]);

export type Scripture = z.infer<typeof ScriptureSchema>;

export const PreparedReviewResultSchema = z
  .object({
    draftId: z.string().uuid(),
    publicReview: PublicReviewSchema,
    privateFormation: PrivateFormationSchema,
    scripture: ScriptureSchema,
    expiresAt: z.string().datetime(),
  })
  .strict();

export type PreparedReviewResult = z.infer<typeof PreparedReviewResultSchema>;

export const PendingDraftSchema = z
  .object({
    version: z.literal(1),
    draftId: z.string().uuid(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    repository: RepositoryRefSchema,
    publicReview: PublicReviewSchema,
  })
  .strict();

export type PendingDraft = z.infer<typeof PendingDraftSchema>;
