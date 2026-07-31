import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { SelahError } from "./errors.js";
import { MAX_INPUT_FILE_BYTES, PreparedReviewInputSchema, type PreparedReviewInput } from "./schemas.js";

export async function readPreparedReviewInput(path: string): Promise<PreparedReviewInput> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new SelahError("INPUT_INVALID", "Review input must be a regular JSON file.");
    }
    if (metadata.size > MAX_INPUT_FILE_BYTES) {
      throw new SelahError("INPUT_INVALID", `Review input cannot exceed ${MAX_INPUT_FILE_BYTES} bytes.`);
    }
    const raw = await handle.readFile("utf8");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new SelahError("INPUT_INVALID", "Review input contains malformed JSON.", { cause: error });
    }
    const parsed = PreparedReviewInputSchema.safeParse(json);
    if (!parsed.success) {
      throw new SelahError("INPUT_INVALID", `Review input is invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}.`);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof SelahError) {
      throw error;
    }
    throw new SelahError("INPUT_INVALID", "Unable to read review input file.", { cause: error });
  } finally {
    await handle?.close();
  }
}
