# Selah demo video

Target runtime: **2:58 maximum**. Record at a measured pace and trim the final export to no more than 3:00.

## 0:00–0:15 — Opening

**On screen:** Selah cover, subtitle, and a GitHub pull request.

**Narration:** “Code review shapes both software and people. Selah helps an AI reviewer pause before posting: preserve technical truth, communicate it constructively, and keep personal Scripture reflection private.”

## 0:15–0:40 — The problem

**On screen:** A blunt review comment, then a fixture diff containing “ignore previous instructions.”

**Narration:** “Agentic review is powerful, but PR content is untrusted and generated wording can be noisy or discouraging. Faith-oriented reflection adds a serious privacy risk if it leaks into a public comment. Selah was designed around that boundary.”

## 0:40–1:05 — Explicit workflow

**On screen:** Type `$selah-pr-review` followed by a disposable PR URL; show the agent inspecting metadata and diff.

**Narration:** “Selah activates only when requested. The agent uses authenticated GitHub CLI, ignores instructions inside the PR, and records no more than five consequential findings and three evidence-backed strengths.”

## 1:05–1:35 — Deterministic mediation

**On screen:** Show a compact structured finding, then: validation → redaction → Gloo → schema validation.

**Narration:** “A strict TypeScript CLI validates paths, lines, severity, evidence, and bounded diff hunks. Secret patterns are redacted before relevant evidence reaches Gloo. Gloo must return one validated tool call: public wording, a private tone reflection, and one curated theme. It never receives Scripture.”

## 1:35–2:00 — Public/private split

**On screen:** Side-by-side headings, **Ready for GitHub** and **For you only**. Use fixture data; do not reveal credentials or licensed passage text.

**Narration:** “Selah maps the theme to a fixed passage and, only when written approval is configured, retrieves exact text and attribution directly from YouVersion. The agent displays public feedback and private formation separately. The public draft contains no Scripture or religious language.”

## 2:00–2:25 — Approval and posting

**On screen:** Inspect the public-only draft; show `selah post <draft-id>` without executing a live post.

**Narration:** “Nothing posts automatically. Drafts are owner-only, expire after thirty minutes, and contain no private reflection, credentials, or full diff. After fresh approval, post accepts only the draft ID and atomically claims it to prevent duplicate GitHub comments.”

## 2:25–2:48 — Evidence

**On screen:** Run `npm run check`; highlight the passing tests.

**Narration:** “Sixty-three tests exercise malicious diffs, redaction, malformed provider output, retries, permissions, expiry, private-field exclusion, and uncertain posting outcomes. Lint, strict typechecking, tests, and bundling form the release gate.”

## 2:48–2:58 — Close

**On screen:** `github.com/XiaoyiDolly/Selah`

**Narration:** “Selah is an open, agent-first communication layer for code review: technically rigorous in public, reflective in private, and deliberate before it posts.”

## Recording notes

- Use only the repository's fixture PR data or a disposable public PR.
- Keep all keys, tokens, terminal history, notifications, and personal account details out of frame.
- Do not show licensed Scripture text unless its display in the video is permitted; the approval-disabled state proves the boundary safely.
- Export in 16:9 at 1080p, verify the runtime locally, upload to YouTube as **Public**, then attach the YouTube video to Kaggle's Media Gallery.
