import { DraftStore } from "./draft-store.js";
import { SelahError } from "./errors.js";
import { assertStoredPublicReviewSafe, formatPublicReview } from "./format.js";
import { GitHubClient, parsePullRequestUrl } from "./github.js";
import type { GlooReview } from "./schemas.js";
import {
  PreparedReviewInputSchema,
  PreparedReviewResultSchema,
  type PreparedReviewInput,
  type PreparedReviewResult,
  type ReflectionTheme,
  type Scripture,
} from "./schemas.js";

export interface GlooReviewProvider {
  review(input: PreparedReviewInput): Promise<GlooReview>;
}

export interface ScriptureProvider {
  getScripture(theme: ReflectionTheme): Promise<Scripture>;
}

export interface ReviewServiceOptions {
  gloo?: GlooReviewProvider;
  drafts: DraftStore;
  github: GitHubClient;
  youVersionAiApproved: boolean;
  scriptureProvider?: ScriptureProvider;
}

export class ReviewService {
  constructor(private readonly options: ReviewServiceOptions) {}

  async prepare(prFlag: string, candidate: PreparedReviewInput): Promise<PreparedReviewResult> {
    const input = PreparedReviewInputSchema.parse(candidate);
    const flagRepository = parsePullRequestUrl(prFlag);
    const inputRepository = parsePullRequestUrl(input.prUrl);
    if (flagRepository.url !== inputRepository.url) {
      throw new SelahError("INPUT_INVALID", "The --pr URL must match prUrl in the input JSON.");
    }

    if (!this.options.gloo) {
      throw new SelahError("CONFIG_INVALID", "Gloo is required to prepare a review.");
    }
    const glooReview = await this.options.gloo.review(input);
    const publicReview = formatPublicReview(input, glooReview);
    const scripture = await this.resolveScripture(glooReview.privateFormation.theme);
    const draft = await this.options.drafts.create(flagRepository, publicReview);

    return PreparedReviewResultSchema.parse({
      draftId: draft.draftId,
      publicReview,
      privateFormation: glooReview.privateFormation,
      scripture,
      expiresAt: draft.expiresAt,
    });
  }

  async post(draftId: string): Promise<void> {
    const claim = await this.options.drafts.claim(draftId);
    try {
      assertStoredPublicReviewSafe(claim.draft.publicReview.body);
      await this.options.github.postReview(claim.draft.repository, claim.draft.publicReview.body);
    } catch (error) {
      if (error instanceof SelahError && error.code === "GITHUB_POST_UNCERTAIN") {
        throw error;
      }
      await this.options.drafts.releaseClaim(claim).catch(() => undefined);
      throw error;
    }
    // Once GitHub accepts the review, never restore the claim: doing so could permit a duplicate post.
    await this.options.drafts.completeClaim(claim).catch(() => undefined);
  }

  discard(draftId: string): Promise<boolean> {
    return this.options.drafts.discard(draftId);
  }

  private async resolveScripture(theme: ReflectionTheme): Promise<Scripture> {
    if (!this.options.youVersionAiApproved) {
      return {
        status: "disabled_pending_approval",
        message: "Live YouVersion retrieval is disabled until written AI-use approval is confirmed.",
      };
    }
    if (!this.options.scriptureProvider) {
      return {
        status: "unavailable",
        message: "Scripture is unavailable because YouVersion credentials are not configured.",
      };
    }
    try {
      return await this.options.scriptureProvider.getScripture(theme);
    } catch {
      return {
        status: "unavailable",
        message: "Scripture could not be retrieved. The public review draft is still available.",
      };
    }
  }
}
