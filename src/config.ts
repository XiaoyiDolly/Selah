import { z } from "zod";

import { SelahError } from "./errors.js";

const BibleIdSchema = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => Number(value) > 0 && Number(value) <= 2_147_483_647);

export interface SelahConfig {
  glooClientId?: string;
  glooClientSecret?: string;
  youVersionAppKey?: string;
  bibleId: string;
  youVersionAiApproved: boolean;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): SelahConfig {
  const rawBibleId = environment.SELAH_BIBLE_ID?.trim() || "3034";
  const parsedBibleId = BibleIdSchema.safeParse(rawBibleId);
  if (!parsedBibleId.success) {
    throw new SelahError("CONFIG_INVALID", "SELAH_BIBLE_ID must be a positive numeric Bible ID.");
  }

  return {
    ...(environment.GLOO_CLIENT_ID ? { glooClientId: environment.GLOO_CLIENT_ID } : {}),
    ...(environment.GLOO_CLIENT_SECRET ? { glooClientSecret: environment.GLOO_CLIENT_SECRET } : {}),
    ...(environment.YOUVERSION_APP_KEY ? { youVersionAppKey: environment.YOUVERSION_APP_KEY } : {}),
    bibleId: String(Number(parsedBibleId.data)),
    youVersionAiApproved: environment.SELAH_YOUVERSION_AI_APPROVED === "true",
  };
}

export function requireGlooCredentials(config: SelahConfig): { clientId: string; clientSecret: string } {
  if (!config.glooClientId || !config.glooClientSecret) {
    throw new SelahError(
      "CONFIG_INVALID",
      "GLOO_CLIENT_ID and GLOO_CLIENT_SECRET are required for prepare.",
    );
  }
  return { clientId: config.glooClientId, clientSecret: config.glooClientSecret };
}
