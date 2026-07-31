import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DraftStore } from "../src/draft-store.js";
import type { PublicReview } from "../src/schemas.js";
import { REPOSITORY } from "./fixtures.js";

const DRAFT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("DraftStore", () => {
  let baseDirectory: string;
  let now: Date;

  beforeEach(async () => {
    baseDirectory = await mkdtemp(join(tmpdir(), "selah-draft-test-"));
    now = new Date("2026-07-31T20:00:00.000Z");
  });

  afterEach(async () => {
    await rm(baseDirectory, { recursive: true, force: true });
  });

  function makeStore(): DraftStore {
    return new DraftStore({ baseDirectory, now: () => now, idFactory: () => DRAFT_ID });
  }

  it("persists only repository identifiers and the public payload with owner-only permissions", async () => {
    const store = makeStore();
    const publicReview = {
      body: "Public review only",
      scripture: "must not serialize",
      privateFormation: { reflection: "must not serialize" },
      diffHunk: "must not serialize",
      credential: "must not serialize",
    } as unknown as PublicReview;
    await store.create(REPOSITORY, publicReview);

    const path = join(baseDirectory, `${DRAFT_ID}.json`);
    const serialized = await readFile(path, "utf8");
    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      draftId: DRAFT_ID,
      createdAt: "2026-07-31T20:00:00.000Z",
      expiresAt: "2026-07-31T20:30:00.000Z",
      repository: REPOSITORY,
      publicReview: { body: "Public review only" },
    });
    expect(serialized).not.toMatch(/scripture|privateFormation|diffHunk|credential/u);
    expect((await stat(baseDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("expires at exactly thirty minutes and removes the draft", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    now = new Date("2026-07-31T20:30:00.000Z");
    await expect(store.load(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_EXPIRED" });
    await expect(stat(join(baseDirectory, `${DRAFT_ID}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects insecure draft permissions", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    await chmod(join(baseDirectory, `${DRAFT_ID}.json`), 0o644);
    await expect(store.load(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_INSECURE" });
  });

  it.each(["../escape", "/absolute", "--body", "not-a-uuid"])("rejects unsafe ID %s", async (id) => {
    await expect(makeStore().load(id)).rejects.toMatchObject({ code: "DRAFT_INVALID" });
  });

  it("atomically permits only one concurrent post claim", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    const results = await Promise.allSettled([store.claim(DRAFT_ID), store.claim(DRAFT_ID)]);
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (successes[0]?.status === "fulfilled") {
      await store.releaseClaim(successes[0].value);
    }
  });

  it("cleans an expired crash-left posting claim", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    const claim = await store.claim(DRAFT_ID);
    now = new Date("2026-07-31T20:31:00.000Z");
    await store.cleanupExpired();
    await expect(stat(claim.claimPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects tampered repository and lifetime invariants", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    const path = join(baseDirectory, `${DRAFT_ID}.json`);
    const draft = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    draft.expiresAt = "2099-01-01T00:00:00.000Z";
    await writeFile(path, JSON.stringify(draft), { mode: 0o600 });
    await expect(store.load(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_INVALID" });

    await writeFile(
      path,
      JSON.stringify({
        ...draft,
        expiresAt: "2026-07-31T20:30:00.000Z",
        repository: { ...REPOSITORY, owner: "attacker" },
      }),
      { mode: 0o600 },
    );
    await expect(store.load(DRAFT_ID)).rejects.toMatchObject({ code: "DRAFT_INVALID" });
  });

  it("discards a pending draft and is idempotent after deletion", async () => {
    const store = makeStore();
    await store.create(REPOSITORY, { body: "Public" });
    await expect(store.discard(DRAFT_ID)).resolves.toBe(true);
    await expect(store.discard(DRAFT_ID)).resolves.toBe(false);
  });
});
