import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readPreparedReviewInput, readPreparedReviewInputFromStdin } from "../src/input.js";
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

describe("review input from stdin", () => {
  const streamOf = (data: string | Buffer): NodeJS.ReadableStream & { isTTY?: boolean } =>
    Readable.from([typeof data === "string" ? Buffer.from(data, "utf8") : data]) as never;

  it("reads and validates piped JSON", async () => {
    await expect(
      readPreparedReviewInputFromStdin(streamOf(JSON.stringify(makeInput()))),
    ).resolves.toEqual(makeInput());
  });

  it("rejects an interactive terminal with no piped input", async () => {
    const tty = Readable.from([]) as never as NodeJS.ReadableStream & { isTTY?: boolean };
    tty.isTTY = true;
    await expect(readPreparedReviewInputFromStdin(tty)).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects empty stdin", async () => {
    await expect(readPreparedReviewInputFromStdin(streamOf("   "))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("rejects an oversized stdin payload", async () => {
    await expect(
      readPreparedReviewInputFromStdin(streamOf(Buffer.alloc(MAX_INPUT_FILE_BYTES + 1, 0x20))),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects malformed JSON on stdin", async () => {
    await expect(readPreparedReviewInputFromStdin(streamOf("{not json"))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
