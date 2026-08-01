import { describe, expect, it, vi } from "vitest";

import { SelahError } from "../src/errors.js";
import type { FetchLike } from "../src/http.js";
import { GlooClient, parseGlooToolCall } from "../src/providers/gloo.js";
import { completionEnvelope, jsonResponse, makeGlooReview, makeInput } from "./fixtures.js";

describe("Gloo required tool output", () => {
  it("independently parses the one expected tool call", () => {
    expect(parseGlooToolCall(completionEnvelope())).toEqual(makeGlooReview());
  });

  it("rejects malformed, multiple, and wrong tool calls", () => {
    expect(() => parseGlooToolCall({ choices: [{ message: { tool_calls: [] } }] })).toThrow(SelahError);
    expect(() =>
      parseGlooToolCall({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "submit_selah_review", arguments: "{}" } },
                { function: { name: "submit_selah_review", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    ).toThrow(SelahError);
    expect(() =>
      parseGlooToolCall({
        choices: [{ message: { tool_calls: [{ function: { name: "other", arguments: "{}" } }] } }],
      }),
    ).toThrow(SelahError);
  });

  it("rejects extra private output and an uncurated theme", () => {
    const invalid = {
      ...makeGlooReview(),
      privateFormation: {
        ...makeGlooReview().privateFormation,
        theme: "revenge",
        scripture: "provider-invented verse",
      },
    };
    expect(() => parseGlooToolCall(completionEnvelope(invalid as never))).toThrow(SelahError);
  });
});

describe("Gloo OAuth and completion behavior", () => {
  it("refreshes OAuth after bounded completion 401 retries and never logs credentials into the request JSON", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ access_token: "first-token", token_type: "Bearer", expires_in: 3600 }),
      new Response("", { status: 401 }),
      new Response("", { status: 401 }),
      new Response("", { status: 401 }),
      jsonResponse({ access_token: "second-token", token_type: "Bearer", expires_in: 3600 }),
      jsonResponse(completionEnvelope()),
    ];
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    });
    const client = new GlooClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher,
      sleep: async () => undefined,
    });

    await expect(client.review(makeInput())).resolves.toEqual(makeGlooReview());
    expect(calls).toHaveLength(6);
    expect(calls.filter((call) => call.url.includes("oauth2/token"))).toHaveLength(2);
    const completionBodies = calls
      .filter((call) => call.url.includes("chat/completions"))
      .map((call) => String(call.init?.body));
    expect(completionBodies).toHaveLength(4);
    expect(completionBodies.join("\n")).not.toContain("client-secret");
    expect(calls[5]?.init?.headers).toMatchObject({ Authorization: "Bearer second-token" });
  });

  it("maps OAuth rejection to a safe authentication error", async () => {
    const fetcher: FetchLike = vi.fn(async () => new Response("client-secret echoed", { status: 401 }));
    const client = new GlooClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher,
      sleep: async () => undefined,
    });
    await expect(client.checkAccess()).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      message: "Gloo OAuth authentication or authorization failed.",
    });
  });
});
