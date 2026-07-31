import { SelahError } from "./errors.js";
import { containsRecognizableSecret } from "./redaction.js";
import type { GlooReview, PreparedReviewInput, PublicReview } from "./schemas.js";
import { PublicReviewSchema } from "./schemas.js";

const SCRIPTURE_REFERENCE_LANGUAGE =
  /\b(?:Bible|biblical|Scripture|verse)\b|\b(?:GEN|EXO|LEV|NUM|DEU|JOS|JDG|RUT|1SA|2SA|1KI|2KI|1CH|2CH|EZR|NEH|EST|JOB|PSA|PRO|ECC|SNG|ISA|JER|LAM|EZK|DAN|HOS|JOL|AMO|OBA|JON|MIC|NAM|HAB|ZEP|HAG|ZEC|MAL|MAT|MRK|LUK|JHN|ACT|ROM|1CO|2CO|GAL|EPH|PHP|COL|1TH|2TH|1TI|2TI|TIT|PHM|HEB|JAS|1PE|2PE|1JN|2JN|3JN|JUD|REV)\.\d{1,3}\.\d{1,3}(?:-\d{1,3})?\b|\b(?:Gen(?:esis)?|Ex(?:od(?:us)?)?|Lev(?:iticus)?|Num(?:bers)?|Deut(?:eronomy)?|Josh(?:ua)?|Judg(?:es)?|Ruth|[12]\s*Sam(?:uel)?|[12]\s*K(?:ings|gs)|[12]\s*Chron(?:icles)?|Ezra|Neh(?:emiah)?|Esth(?:er)?|Job|Psalms?|Prov(?:erbs)?|Eccl(?:esiastes)?|Song(?:\s+of\s+Solomon)?|Isa(?:iah)?|Jer(?:emiah)?|Lam(?:entations)?|Ezek(?:iel)?|Dan(?:iel)?|Hos(?:ea)?|Joel|Amos|Obad(?:iah)?|Jonah|Mic(?:ah)?|Nah(?:um)?|Hab(?:akkuk)?|Zeph(?:aniah)?|Hag(?:gai)?|Zech(?:ariah)?|Mal(?:achi)?|Matt?(?:hew)?|Mark|Luke|John|Acts|Rom(?:ans)?|[12]\s*Cor(?:inthians)?|Gal(?:atians)?|Eph(?:esians)?|Phil(?:ippians)?|Col(?:ossians)?|[12]\s*Thess(?:alonians)?|[12]\s*Tim(?:othy)?|Titus|Philem(?:on)?|Heb(?:rews)?|James|[12]\s*Pet(?:er)?|[123]\s*John|Jude|Rev(?:elation)?)\.?\s+\d{1,3}\s*[:.]\s*\d{1,3}/iu;

const RELIGIOUS_PUBLIC_LANGUAGE =
  /\b(?:Jesus|Christ|God|Creator|Lord|pray|prayer|faith|church|spiritual|sin|holy|gospel|worship|salvation|amen|bless(?:ed|ing)?|pastor|disciple|apostle)\b/iu;

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/([\\`*_{}[\]<>()#+.!|~-])/gu, "\\$1")
    .replace(/@/gu, "@\u200B")
    .trim();
}

function assertPublicTextSafe(text: string): void {
  if (containsRecognizableSecret(text)) {
    throw new SelahError("PUBLIC_CONTENT_UNSAFE", "Public review content resembles a credential or secret.");
  }
  if (SCRIPTURE_REFERENCE_LANGUAGE.test(text) || RELIGIOUS_PUBLIC_LANGUAGE.test(text)) {
    throw new SelahError("PUBLIC_CONTENT_UNSAFE", "Public review content contains religious or Scripture-related language.");
  }
}

export function assertStoredPublicReviewSafe(body: string): void {
  PublicReviewSchema.parse({ body });
  assertPublicTextSafe(body);
}

export function assertGlooCorrespondence(input: PreparedReviewInput, review: GlooReview): void {
  const commentIndexes = review.comments.map((comment) => comment.findingIndex);
  const strengthIndexes = review.strengths.map((strength) => strength.strengthIndex);
  if (
    commentIndexes.length !== input.findings.length ||
    new Set(commentIndexes).size !== input.findings.length ||
    commentIndexes.some((index) => index >= input.findings.length)
  ) {
    throw new SelahError("PROVIDER_MALFORMED", "Gloo did not preserve a one-to-one mapping to submitted findings.");
  }
  if (
    strengthIndexes.length !== input.strengths.length ||
    new Set(strengthIndexes).size !== input.strengths.length ||
    strengthIndexes.some((index) => index >= input.strengths.length)
  ) {
    throw new SelahError("PROVIDER_MALFORMED", "Gloo did not preserve a one-to-one mapping to submitted strengths.");
  }
}

export function assertPublicContentSafe(review: GlooReview): void {
  const publicText = [
    review.publicSummary,
    ...review.comments.flatMap((comment) => [comment.wording, comment.encouragement ?? ""]),
    ...review.strengths.map((strength) => strength.wording),
  ].join("\n");
  assertPublicTextSafe(publicText);
  const privateText = `${review.privateFormation.toneReflection}\n${review.privateFormation.reflectionQuestion}`;
  if (SCRIPTURE_REFERENCE_LANGUAGE.test(privateText)) {
    throw new SelahError("PUBLIC_CONTENT_UNSAFE", "Gloo returned Scripture content outside the curated theme.");
  }
}

export function formatPublicReview(input: PreparedReviewInput, review: GlooReview): PublicReview {
  if (containsRecognizableSecret(JSON.stringify(review))) {
    throw new SelahError("PUBLIC_CONTENT_UNSAFE", "Gloo returned content resembling a credential or secret.");
  }
  assertGlooCorrespondence(input, review);
  assertPublicContentSafe(review);
  const agentTechnicalText = input.findings
    .flatMap((finding) => [finding.issue, finding.evidence, finding.proposedFix ?? ""])
    .join("\n");
  assertPublicTextSafe(agentTechnicalText);
  const lines = ["## Pull request review", "", escapeMarkdownText(review.publicSummary)];

  if (review.comments.length === 0) {
    lines.push("", "### Findings", "", "No consequential issues were identified in the reviewed changes.");
  } else {
    lines.push("", "### Findings");
    for (const comment of [...review.comments].sort((left, right) => left.findingIndex - right.findingIndex)) {
      const finding = input.findings[comment.findingIndex];
      if (!finding) {
        throw new SelahError("PROVIDER_MALFORMED", "Gloo referenced an unknown finding.");
      }
      const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
      lines.push(
        "",
        `#### ${finding.severity} — \`${location}\``,
        "",
        escapeMarkdownText(comment.wording),
        "",
        `**Technical concern:** ${escapeMarkdownText(finding.issue)}`,
        "",
        `**Evidence:** ${escapeMarkdownText(finding.evidence)}`,
      );
      if (finding.proposedFix) {
        lines.push("", `**Suggested change:** ${escapeMarkdownText(finding.proposedFix)}`);
      }
      if (comment.encouragement) {
        lines.push("", `What is working well: ${escapeMarkdownText(comment.encouragement)}`);
      }
    }
  }

  if (review.strengths.length > 0) {
    lines.push("", "### Strengths");
    for (const strength of [...review.strengths].sort(
      (left, right) => left.strengthIndex - right.strengthIndex,
    )) {
      lines.push("", `- ${escapeMarkdownText(strength.wording)}`);
    }
  }

  const publicReview = PublicReviewSchema.parse({ body: `${lines.join("\n").trim()}\n` });
  assertStoredPublicReviewSafe(publicReview.body);
  return publicReview;
}
