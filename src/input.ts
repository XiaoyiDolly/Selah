import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { SelahError } from "./errors.js";
import { MAX_INPUT_FILE_BYTES, PreparedReviewInputSchema, type PreparedReviewInput } from "./schemas.js";

function parsePreparedReviewInput(raw: string): PreparedReviewInput {
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_FILE_BYTES) {
    throw new SelahError("INPUT_INVALID", `Review input cannot exceed ${MAX_INPUT_FILE_BYTES} bytes.`);
  }
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
}

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
    return parsePreparedReviewInput(raw);
  } catch (error) {
    if (error instanceof SelahError) {
      throw error;
    }
    throw new SelahError("INPUT_INVALID", "Unable to read review input file.", { cause: error });
  } finally {
    await handle?.close();
  }
}

export async function readPreparedReviewInputFromStdin(
  stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
): Promise<PreparedReviewInput> {
  if (stdin.isTTY) {
    throw new SelahError(
      "INPUT_INVALID",
      "No review input provided. Pass --input <file> or pipe the findings JSON via stdin.",
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
    total += buffer.length;
    if (total > MAX_INPUT_FILE_BYTES) {
      throw new SelahError("INPUT_INVALID", `Review input cannot exceed ${MAX_INPUT_FILE_BYTES} bytes.`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    throw new SelahError("INPUT_INVALID", "No review input received on stdin.");
  }
  return parsePreparedReviewInput(raw);
}
