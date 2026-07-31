# Selah: Pause Before You Post

## An agent-first pull-request reviewer that pairs rigorous public feedback with private, attributed Scripture reflection

### Problem

Code review is where engineering rigor and human friction meet. Agentic reviewers can find defects quickly, but raw feedback may be noisy, overly certain, or discouraging. Adding faith-oriented reflection creates another risk: private Scripture or spiritual language could leak into a teammate's public GitHub review. Selah addresses both problems by treating technical evidence as authoritative and enforcing a hard boundary between public feedback and private formation.

### Approach

Selah is an explicitly invoked Codex skill: `$selah-pr-review <PR URL>`. The agent inspects a pull request with authenticated GitHub CLI, ignores instructions embedded in PR content, and selects at most five consequential findings plus three evidence-backed strengths. A deterministic TypeScript CLI validates paths, lines, severity, evidence, and size-bounded diff hunks. Only relevant, secret-redacted evidence reaches Gloo Completions V2.

Gloo must return one schema-validated tool call. It preserves each finding's technical substance while shaping specific, constructive wording, a private tone reflection, and one curated theme: truth and grace, humility, patience, encouragement, or wisdom. Selah then maps that theme to a fixed passage and retrieves the exact text, version metadata, and copyright attribution directly from YouVersion. Scripture is never sent to Gloo.

### Technical Architecture

The workflow is: inspect PR → validate structured evidence → redact secrets → generate and validate wording → retrieve attributed Scripture → display two sections. **Ready for GitHub** contains only the proposed public review. **For you only** contains the tone reflection and Scripture. Posting requires fresh confirmation and the command `selah post <draft-id>`; the posting path cannot accept arbitrary private fields.

### Safety and Privacy

Credentials come only from environment variables. Pending drafts expire after 30 minutes, use owner-only permissions, and contain only canonical repository identifiers and the public payload—never Scripture, reflection, credentials, or full diffs. Posting uses GitHub CLI without a shell and atomically claims drafts to prevent duplicate comments. Live YouVersion access defaults off and requires confirmed written AI-use approval.

### Testing and Results

The release gate runs ESLint, strict TypeScript, 63 Vitest tests, and an esbuild production bundle. Mocked tests cover malformed provider output, retries, authentication failures, malicious diff instructions, secret redaction, no-findings reviews, draft expiry and permissions, private-field exclusion, and uncertain GitHub outcomes. The MVP is local and explicit; live posting is intentionally blocked until authentication, provider credentials, and approval are available.

### Links

- Public Notebook: **add the public Kaggle notebook URL before submission**
- Demo Video: **add the public YouTube URL before submission**
- Public Project: [GitHub repository](https://github.com/XiaoyiDolly/Selah)
