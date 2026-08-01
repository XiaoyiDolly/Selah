# Selah

Selah is an agent-first communication layer for GitHub pull request review. A Codex skill guides the private workflow; a deterministic TypeScript CLI validates review evidence, mediates wording through Gloo, optionally retrieves an attributed YouVersion passage for private reflection, and posts only an approved public draft.

The MVP is local and explicit:

```text
$selah-pr-review https://github.com/org/repo/pull/123
```

Ordinary code reviews do not activate Selah. Native `@codex review`, automatic GitHub events, inline comments, hosted authentication, MCP/plugin packaging, and a VS Code extension are intentionally out of scope.

## Requirements

- Node.js 22 (the repository includes a Volta pin for 22.23.1)
- `gh`, authenticated with `gh auth login`
- Gloo OAuth2 client credentials
- A YouVersion application key and written AI-use approval before enabling live Scripture retrieval

### Install from npm

The package is published publicly on npm. Install the `selah` binary globally:

```sh
npm install -g @selah-wisdom/pr-review
selah doctor
```

> Using [Volta](https://volta.sh)? Run `volta install @selah-wisdom/pr-review` instead — Volta does not put `npm install -g` binaries on your `PATH`, but `volta install` creates a proper `selah` shim.

### Install from source

For development, or without npm scope access, work from a checkout:

```sh
npm install
npm run check
npm run selah -- doctor
```

Optionally run `npm link` to expose the built `selah` binary globally; the source checkout always supports `npm run selah -- <command>`.

## Configuration

Credentials are read only from the environment:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GLOO_CLIENT_ID` | Gloo OAuth2 client ID | required for `prepare` |
| `GLOO_CLIENT_SECRET` | Gloo OAuth2 client secret | required for `prepare` |
| `YOUVERSION_APP_KEY` | YouVersion Bible API application key | required only for live Scripture |
| `SELAH_BIBLE_ID` | Licensed YouVersion Bible ID | `3034` (BSB) |
| `SELAH_YOUVERSION_AI_APPROVED` | Explicit written AI-use approval gate | `false` |

Only the exact value `true` enables YouVersion calls. Keep it `false` until written approval is confirmed under the current [YouVersion Platform Terms](https://platform.youversion.com/terms).

## CLI

```sh
selah doctor

# Provide findings via file...
selah prepare --pr https://github.com/org/repo/pull/123 --input /secure/path/review.json
# ...or pipe them on stdin (no temp file needed):
your-agent-review "$PR" | selah prepare --pr https://github.com/org/repo/pull/123

selah post 123e4567-e89b-42d3-a456-426614174000
selah discard 123e4567-e89b-42d3-a456-426614174000
```

During development, replace `selah` with `npm run selah --`.

`prepare` reads the structured input from `--input <path>`, or from stdin when `--input` is omitted, so an agent can stream findings directly without writing a temporary file. The input format is documented in [.agents/skills/selah-pr-review/references/review-input.md](.agents/skills/selah-pr-review/references/review-input.md). Gloo is called through OAuth2 and [Completions V2](https://docs.gloo.com/api-guides/completions-v2), with a required function call whose arguments are independently validated.

The five private reflection themes map to fixed USFM passages:

| Theme | Passage |
| --- | --- |
| `truth_and_grace` | `EPH.4.15` |
| `humility` | `PHP.2.3-4` |
| `patience` | `JAS.1.19-20` |
| `encouragement` | `1TH.5.11` |
| `wisdom` | `JAS.1.5` |

Passage text and version metadata come directly from the [YouVersion Bible API](https://developers.youversion.com/api/bibles). Scripture is fetched only after Gloo returns a validated theme and is never sent to Gloo.

## Security boundary

- Review input is strict, size-bounded, and treated as untrusted data. Known secret patterns are redacted before Gloo receives it.
- Pending drafts live under the OS temporary directory for 30 minutes. The directory is `0700`; draft files are `0600`.
- Draft JSON contains only the canonical repository identifiers and public review payload. It cannot serialize diff hunks, credentials, Scripture, private formation, or raw provider data.
- `post` accepts only a UUID draft ID. It atomically claims the draft and sends the body over stdin to `gh pr review --comment --body-file -`, without a shell.
- A successful post deletes the draft. A failed post restores the original draft without extending its expiry. `discard` deletes without posting.
- If a started `gh` process times out or loses its result, Selah keeps a non-retryable claim until expiry and requires inspecting the PR manually, preventing an uncertain duplicate post.
- The Codex skill must display **Agent evidence + Gloo wording — Ready for GitHub** and **Gloo reflection + Scripture — For you only** separately, label available text as **YouVersion Scripture** (or a disabled/unavailable result as **Selah Scripture status**), and obtain fresh, explicit approval before `post`.

## Current live state

Tests use mocked provider and GitHub boundaries. Live preparation requires Gloo credentials. Live posting requires valid `gh` authentication. Live YouVersion retrieval remains disabled by default pending written AI-use approval.

## Kaggle submission materials

The upload-ready Writeup, public companion notebook, cover image, video storyboard, and eligibility checklist are in [`submission/`](submission/README.md). The notebook is deliberately self-contained and demonstrates Selah's deterministic safety boundary without credentials, network access, licensed Scripture text, or live posting.
