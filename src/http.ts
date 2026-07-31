import type { ZodType } from "zod";

import { SelahError } from "./errors.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  sleep?: Sleep;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const defaultSleep: Sleep = async (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function fetchWithRetry(
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        throw new SelahError("PROVIDER_UNAVAILABLE", "Provider request failed after bounded retries.", {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
    await sleep(200 * 2 ** attempt);
  }

  throw new SelahError("PROVIDER_UNAVAILABLE", "Provider request failed.", { cause: lastError });
}

export async function parseJsonResponse<T>(
  response: Response,
  schema: ZodType<T>,
  providerName: string,
  maximumBytes = 256 * 1024,
): Promise<T> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new SelahError("PROVIDER_MALFORMED", `${providerName} returned an oversized response.`);
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new SelahError("PROVIDER_MALFORMED", `${providerName} returned an oversized response.`);
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new SelahError("PROVIDER_MALFORMED", `${providerName} returned malformed JSON.`, {
      cause: error,
    });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new SelahError("PROVIDER_MALFORMED", `${providerName} returned an invalid response shape.`);
  }
  return parsed.data;
}
