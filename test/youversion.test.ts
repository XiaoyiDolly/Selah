import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/http.js";
import { THEME_PASSAGES, YouVersionClient } from "../src/providers/youversion.js";
import { jsonResponse } from "./fixtures.js";

describe("YouVersion boundary", () => {
  it("uses the exact curated USFM passage mapping", () => {
    expect(THEME_PASSAGES).toEqual({
      truth_and_grace: "EPH.4.15",
      humility: "PHP.2.3-4",
      patience: "JAS.1.19-20",
      encouragement: "1TH.5.11",
      wisdom: "JAS.1.5",
    });
  });

  it("validates passage and version metadata and returns required attribution", async () => {
    const fetcher: FetchLike = vi.fn(async (input, init) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({ "X-YVP-App-Key": "app-key" });
      if (url.includes("/passages/")) {
        expect(url).toContain("EPH.4.15");
        expect(url).toContain("format=text");
        return jsonResponse({ id: "EPH.4.15", content: "Speaking the truth in love.", reference: "Ephesians 4:15" });
      }
      return jsonResponse({
        id: 3034,
        title: "Berean Standard Bible",
        abbreviation: "BSB",
        copyright: "Copyright text required by the publisher.",
        publisher_url: "",
        youversion_deep_link: "https://www.bible.com/versions/3034",
      });
    });
    const client = new YouVersionClient({ appKey: "app-key", bibleId: "3034", fetcher });
    const result = await client.getScripture("truth_and_grace");
    expect(result).toMatchObject({
      status: "available",
      reference: "Ephesians 4:15",
      text: "Speaking the truth in love.",
      versionId: "3034",
      versionAbbreviation: "BSB",
    });
    if (result.status === "available") {
      expect(result.attribution).toContain("Berean Standard Bible (BSB)");
      expect(result.attribution).toContain("Copyright text required by the publisher.");
    }
  });

  it("rejects wrong Bible or passage identities", async () => {
    const wrongBible: FetchLike = vi.fn(async (input) =>
      String(input).includes("/passages/")
        ? jsonResponse({ id: "EPH.4.15", content: "Text", reference: "Ephesians 4:15" })
        : jsonResponse({ id: 9999, title: "Wrong", abbreviation: "W", copyright: "Copyright" }),
    );
    await expect(
      new YouVersionClient({ appKey: "app-key", bibleId: "3034", fetcher: wrongBible }).getScripture(
        "truth_and_grace",
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });

    const wrongPassage: FetchLike = vi.fn(async (input) =>
      String(input).includes("/passages/")
        ? jsonResponse({ id: "JHN.3.16", content: "Wrong", reference: "John 3:16" })
        : jsonResponse({ id: 3034, title: "Bible", abbreviation: "B", copyright: "Copyright" }),
    );
    await expect(
      new YouVersionClient({ appKey: "app-key", bibleId: "3034", fetcher: wrongPassage }).getScripture(
        "truth_and_grace",
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });

  it("maps invalid access without exposing the response body", async () => {
    const fetcher: FetchLike = vi.fn(async () => new Response("secret provider detail", { status: 401 }));
    const client = new YouVersionClient({ appKey: "app-key", bibleId: "3034", fetcher });
    await expect(client.checkBibleAccess()).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      message: "YouVersion Bible metadata access is unavailable.",
    });
  });

  it("fails closed when copyright attribution is absent", async () => {
    const fetcher: FetchLike = vi.fn(async (input) =>
      String(input).includes("/passages/")
        ? jsonResponse({ id: "JAS.1.5", content: "Text", reference: "James 1:5" })
        : jsonResponse({ id: 3034, title: "Bible", abbreviation: "B" }),
    );
    const client = new YouVersionClient({ appKey: "app-key", bibleId: "3034", fetcher });
    await expect(client.getScripture("wisdom")).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });
});
