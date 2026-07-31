import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "../src/doctor.js";
import { GitHubClient, type ProcessRunner } from "../src/github.js";

describe("doctor", () => {
  it("reports a ready environment after every live boundary validates", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const result = await runDoctor(
      {
        glooClientId: "present",
        glooClientSecret: "present",
        youVersionAppKey: "present",
        bibleId: "3034",
        youVersionAiApproved: true,
      },
      new GitHubClient(runner),
      { checkAccess: vi.fn().mockResolvedValue(undefined) },
      { checkBibleAccess: vi.fn().mockResolvedValue(undefined) },
    );
    expect(result.ready).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("blocks YouVersion without calling it unless approval is explicit", async () => {
    const bible = { checkBibleAccess: vi.fn() };
    const result = await runDoctor(
      { bibleId: "3034", youVersionAiApproved: false },
      new GitHubClient(async () => ({ exitCode: 1, stdout: "", stderr: "invalid token" })),
      undefined,
      bible,
    );
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "YouVersion access", status: "blocked" }),
    );
    expect(bible.checkBibleAccess).not.toHaveBeenCalled();
  });
});
