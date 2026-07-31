import { describe, expect, it } from "vitest";

import { runProcess, scrubProviderEnvironment } from "../src/github.js";

describe("GitHub child environment", () => {
  it("removes provider credentials while retaining GitHub authentication", () => {
    expect(
      scrubProviderEnvironment({
        GLOO_CLIENT_ID: "id",
        GLOO_CLIENT_SECRET: "secret",
        YOUVERSION_APP_KEY: "key",
        GH_TOKEN: "github-token",
        PATH: "/usr/bin",
      }),
    ).toEqual({ GH_TOKEN: "github-token", PATH: "/usr/bin" });
  });

  it("force-kills an uncooperative timed-out child and marks the outcome uncertain", async () => {
    await expect(
      runProcess(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000)"],
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ outcome: "uncertain" });
  });
});
