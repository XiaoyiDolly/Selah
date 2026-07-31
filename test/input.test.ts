import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readPreparedReviewInput } from "../src/input.js";
import { MAX_INPUT_FILE_BYTES } from "../src/schemas.js";
import { makeInput } from "./fixtures.js";

describe("bounded review input files", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "selah-input-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads and validates a regular bounded JSON file", async () => {
    const path = join(directory, "review.json");
    await writeFile(path, JSON.stringify(makeInput()), { mode: 0o600 });
    await expect(readPreparedReviewInput(path)).resolves.toEqual(makeInput());
  });

  it("rejects the file before reading an oversized payload", async () => {
    const path = join(directory, "oversized.json");
    await writeFile(path, Buffer.alloc(MAX_INPUT_FILE_BYTES + 1, 0x20), { mode: 0o600 });
    await expect(readPreparedReviewInput(path)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
