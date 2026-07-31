import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "../src/draft-store.js";
import { GitHubClient, ProcessRunError, type ProcessRunner } from "../src/github.js";
import { ReviewService } from "../src/review-service.js";
import type { Scripture } from "../src/schemas.js";
import { makeGlooReview, makeInput, REPOSITORY } from "./fixtures.js";

const DRAFT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("ReviewService", () => {
  let baseDirectory: string;
  let drafts: DraftStore;

  beforeEach(async () => {
    baseDirectory = await mkdtemp(join(tmpdir(), "selah-service-test-"));
    drafts = new DraftStore({ baseDirectory, idFactory: () => DRAFT_ID });
  });

  afterEach(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  it("prepares a public-only draft and returns private formation separately", async () => {
    const glooPayloads: string[] = [];
    const scripture: Scripture = {
      status: "available",
      passageId: "EPH.4.15",
      reference: "Ephesians 4:15",
      text: "Known private verse text",
      versionId: "3034",
      versionTitle: "Berean Standard Bible",
      versionAbbreviation: "BSB",
      copyright: "Copyright attribution",
      attribution: "Berean Standard Bible (BSB). Copyright attribution",
    };
    const service = new ReviewService({
      gloo: {
        review: async (input) => {
          glooPayloads.push(JSON.stringify(input));
          return makeGlooReview();
        },
      },
      scriptureProvider: { getScripture: async () => scripture },
      drafts,
      github: new GitHubClient(),
      youVersionAiApproved: true,
    });

    const result = await service.prepare(REPOSITORY.url, makeInput());
    expect(result.scripture).toEqual(scripture);
    expect(result.privateFormation.theme).toBe("truth_and_grace");
    expect(glooPayloads.join("\n")).not.toContain("Known private verse text");

    const [file] = await readdir(baseDirectory);
    const serialized = await readFile(join(baseDirectory, file ?? "missing"), "utf8");
    expect(serialized).toContain("publicReview");
    expect(serialized).not.toContain("Known private verse text");
    expect(serialized).not.toContain("privateFormation");
    expect(serialized).not.toContain("diffHunk");
  });

  it("keeps a public draft available after a partial YouVersion failure", async () => {
    const service = new ReviewService({
      gloo: { review: async () => makeGlooReview() },
      scriptureProvider: { getScripture: async () => Promise.reject(new Error("provider secret")) },
      drafts,
      github: new GitHubClient(),
      youVersionAiApproved: true,
    });
    const result = await service.prepare(REPOSITORY.url, makeInput());
    expect(result.scripture).toEqual({
      status: "unavailable",
      message: "Scripture could not be retrieved. The public review draft is still available.",
    });
    await expect(drafts.load(DRAFT_ID)).resolves.toBeDefined();
  });

  it("does not call YouVersion while approval is disabled", async () => {
    const scriptureProvider = { getScripture: vi.fn() };
    const service = new ReviewService({
      gloo: { review: async () => makeGlooReview() },
      scriptureProvider,
      drafts,
      github: new GitHubClient(),
      youVersionAiApproved: false,
    });
    const result = await service.prepare(REPOSITORY.url, makeInput());
    expect(result.scripture.status).toBe("disabled_pending_approval");
    expect(scriptureProvider.getScripture).not.toHaveBeenCalled();
  });

  it("fails before Scripture and draft creation when Gloo mapping is invalid", async () => {
    const scriptureProvider = { getScripture: vi.fn() };
    const service = new ReviewService({
      gloo: { review: async () => makeGlooReview({ comments: [] }) },
      scriptureProvider,
      drafts,
      github: new GitHubClient(),
      youVersionAiApproved: true,
    });
    await expect(service.prepare(REPOSITORY.url, makeInput())).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED",
    });
    expect(scriptureProvider.getScripture).not.toHaveBeenCalled();
    expect(await readdir(baseDirectory)).toEqual([]);
  });

  it("posts through an exact gh argument vector and deletes the successful draft", async () => {
    await drafts.create(REPOSITORY, { body: "Approved public body" });
    const runner: ProcessRunner = vi.fn(async (_command, _args, options) => ({
      exitCode: 0,
      stdout: "",
      stderr: options?.input ?? "",
    }));
    const service = new ReviewService({
      drafts,
      github: new GitHubClient(runner),
      youVersionAiApproved: false,
    });
    await service.post(DRAFT_ID);
    expect(runner).toHaveBeenCalledWith(
      "gh",
      ["pr", "review", REPOSITORY.url, "--comment", "--body-file", "-"],
      { input: "Approved public body", timeoutMs: 30_000 },
    );
    await expect(drafts.load(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  });

  it("restores the original draft after a failed post", async () => {
    const draft = await drafts.create(REPOSITORY, { body: "Approved public body" });
    const runner: ProcessRunner = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "denied" }));
    const service = new ReviewService({
      drafts,
      github: new GitHubClient(runner),
      youVersionAiApproved: false,
    });
    await expect(service.post(DRAFT_ID)).rejects.toMatchObject({ code: "GITHUB_POST" });
    const restored = await drafts.load(DRAFT_ID);
    expect(restored.expiresAt).toBe(draft.expiresAt);
  });

  it("re-runs public safety after loading a tampered draft", async () => {
    await drafts.create(REPOSITORY, { body: "Approved public body" });
    const path = join(baseDirectory, `${DRAFT_ID}.json`);
    const draft = JSON.parse(await readFile(path, "utf8")) as { publicReview: { body: string } };
    draft.publicReview.body = "Post JAS.1.5 to the pull request";
    await writeFile(path, JSON.stringify(draft), { mode: 0o600 });
    const runner: ProcessRunner = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const service = new ReviewService({
      drafts,
      github: new GitHubClient(runner),
      youVersionAiApproved: false,
    });
    await expect(service.post(DRAFT_ID)).rejects.toMatchObject({ code: "PUBLIC_CONTENT_UNSAFE" });
    expect(runner).not.toHaveBeenCalled();
    await expect(drafts.load(DRAFT_ID)).resolves.toBeDefined();
  });

  it("keeps an uncertain GitHub outcome non-retryable until expiry", async () => {
    await drafts.create(REPOSITORY, { body: "Approved public body" });
    const runner: ProcessRunner = vi.fn(async () =>
      Promise.reject(new ProcessRunError("timed out", "uncertain")),
    );
    const service = new ReviewService({
      drafts,
      github: new GitHubClient(runner),
      youVersionAiApproved: false,
    });
    await expect(service.post(DRAFT_ID)).rejects.toMatchObject({ code: "GITHUB_POST_UNCERTAIN" });
    expect(await readdir(baseDirectory)).toEqual([`${DRAFT_ID}.posting`]);
    await expect(service.post(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
