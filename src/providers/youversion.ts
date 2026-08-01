import { z } from "zod";

import { SelahError } from "../errors.js";
import { fetchWithRetry, parseJsonResponse, type FetchLike, type Sleep } from "../http.js";
import type { ReflectionTheme, Scripture } from "../schemas.js";

const YOUVERSION_API_BASE = "https://api.youversion.com/v1";

export const THEME_PASSAGES: Readonly<Record<ReflectionTheme, string>> = {
  truth_and_grace: "EPH.4.15",
  humility: "PHP.2.3-4",
  patience: "JAS.1.19-20",
  encouragement: "1TH.5.11",
  wisdom: "JAS.1.5",
};

const BibleResponseSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int().positive()]),
    title: z.string().min(1),
    abbreviation: z.string().min(1),
    copyright: z.string().min(1),
    info: z.string().min(1).nullable().optional(),
    publisher_url: z.union([z.literal(""), z.string().url()]).nullable().optional(),
    youversion_deep_link: z.string().url().optional(),
  })
  .passthrough();

const PassageResponseSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1),
    reference: z.string().min(1),
  })
  .passthrough();

export interface YouVersionClientOptions {
  appKey: string;
  bibleId: string;
  fetcher?: FetchLike;
  sleep?: Sleep;
}

export class YouVersionClient {
  private readonly fetcher: FetchLike;
  private readonly sleep?: Sleep;

  constructor(private readonly options: YouVersionClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep;
  }

  async checkBibleAccess(): Promise<void> {
    await this.getBible();
  }

  async getScripture(theme: ReflectionTheme): Promise<Scripture> {
    const passageId = THEME_PASSAGES[theme];
    const [bible, passage] = await Promise.all([this.getBible(), this.getPassage(passageId)]);
    const attribution = `${bible.title} (${bible.abbreviation}). ${bible.copyright}${
      bible.publisher_url ? ` Publisher: ${bible.publisher_url}` : ""
    }`;
    return {
      status: "available",
      passageId,
      reference: passage.reference,
      text: passage.content.trim(),
      versionId: String(bible.id),
      versionTitle: bible.title,
      versionAbbreviation: bible.abbreviation,
      copyright: bible.copyright,
      attribution,
      ...(bible.youversion_deep_link ? { youVersionUrl: bible.youversion_deep_link } : {}),
    };
  }

  private async getBible() {
    const bible = await this.getValidated(
      `${YOUVERSION_API_BASE}/bibles/${encodeURIComponent(this.options.bibleId)}`,
      BibleResponseSchema,
      "YouVersion Bible metadata",
    );
    if (String(bible.id) !== this.options.bibleId) {
      throw new SelahError("PROVIDER_MALFORMED", "YouVersion returned metadata for the wrong Bible version.");
    }
    return bible;
  }

  private async getPassage(passageId: string) {
    const query = new URLSearchParams({
      format: "text",
      include_headings: "false",
      include_notes: "false",
    });
    const passage = await this.getValidated(
      `${YOUVERSION_API_BASE}/bibles/${encodeURIComponent(this.options.bibleId)}/passages/${encodeURIComponent(
        passageId,
      )}?${query.toString()}`,
      PassageResponseSchema,
      "YouVersion passage",
    );
    if (passage.id !== passageId) {
      throw new SelahError("PROVIDER_MALFORMED", "YouVersion returned a passage different from the curated mapping.");
    }
    return passage;
  }

  private async getValidated<T>(url: string, schema: z.ZodType<T>, label: string): Promise<T> {
    const response = await fetchWithRetry(
      this.fetcher,
      url,
      {
        method: "GET",
        headers: { "X-YVP-App-Key": this.options.appKey },
      },
      { attempts: 3, timeoutMs: 15_000, ...(this.sleep ? { sleep: this.sleep } : {}) },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new SelahError("PROVIDER_AUTH", `${label} access is unavailable.`);
      }
      throw new SelahError("PROVIDER_UNAVAILABLE", `${label} failed with HTTP ${response.status}.`);
    }
    return parseJsonResponse(response, schema, label);
  }
}
