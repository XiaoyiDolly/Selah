import { describe, expect, it, vi } from "vitest";

import { fetchWithRetry, parseJsonResponse } from "../src/http.js";
import { z } from "zod";

describe("bounded retries", () => {
  it("retries transient statuses and stops after success", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const response = await fetchWithRetry(fetcher, "https://provider.example", {}, { sleep });
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry invalid authentication", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("no", { status: 401 }));
    const response = await fetchWithRetry(fetcher, "https://provider.example", {});
    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("bounded response parsing", () => {
  it("rejects a streaming response before retaining an oversized body", async () => {
    const response = new Response(JSON.stringify({ value: "x".repeat(1_000) }));
    await expect(parseJsonResponse(response, z.object({ value: z.string() }), "Test", 64)).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED",
    });
  });
});
