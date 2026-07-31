import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { Command } from "commander";

import { readConfig, requireGlooCredentials } from "./config.js";
import { runDoctor } from "./doctor.js";
import { DraftStore } from "./draft-store.js";
import { SelahError } from "./errors.js";
import { GitHubClient } from "./github.js";
import { readPreparedReviewInput } from "./input.js";
import { GlooClient } from "./providers/gloo.js";
import { YouVersionClient } from "./providers/youversion.js";
import { safeErrorMessage } from "./redaction.js";
import { ReviewService } from "./review-service.js";

interface PrepareOptions {
  pr: string;
  input: string;
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("selah")
    .description("Prepare and explicitly post grace-oriented GitHub pull request reviews.")
    .version("0.1.0")
    .allowExcessArguments(false)
    .showHelpAfterError();

  program
    .command("doctor")
    .description("Validate credentials, provider access, Bible access, and GitHub CLI authentication.")
    .allowExcessArguments(false)
    .action(async () => {
      const config = readConfig();
      const github = new GitHubClient();
      const gloo =
        config.glooClientId && config.glooClientSecret
          ? new GlooClient({ clientId: config.glooClientId, clientSecret: config.glooClientSecret })
          : undefined;
      const youVersion =
        config.youVersionAiApproved && config.youVersionAppKey
          ? new YouVersionClient({ appKey: config.youVersionAppKey, bibleId: config.bibleId })
          : undefined;
      const result = await runDoctor(config, github, gloo, youVersion);
      for (const check of result.checks) {
        console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}: ${check.detail}`);
      }
      if (!result.ready) {
        process.exitCode = 1;
      }
    });

  program
    .command("prepare")
    .description("Validate findings and prepare a short-lived public GitHub review draft.")
    .requiredOption("--pr <url>", "Canonical GitHub pull request URL")
    .requiredOption("--input <json>", "Path to the structured review input JSON file")
    .allowExcessArguments(false)
    .action(async (options: PrepareOptions) => {
      const config = readConfig();
      const credentials = requireGlooCredentials(config);
      const input = await readPreparedReviewInput(options.input);
      const gloo = new GlooClient(credentials);
      const scriptureProvider =
        config.youVersionAiApproved && config.youVersionAppKey
          ? new YouVersionClient({ appKey: config.youVersionAppKey, bibleId: config.bibleId })
          : undefined;
      const service = new ReviewService({
        gloo,
        drafts: new DraftStore(),
        github: new GitHubClient(),
        youVersionAiApproved: config.youVersionAiApproved,
        ...(scriptureProvider ? { scriptureProvider } : {}),
      });
      const result = await service.prepare(options.pr, input);
      console.log(JSON.stringify(result, null, 2));
    });

  program
    .command("post")
    .description("Post one stored public review after explicit user approval.")
    .argument("<draft-id>", "Pending draft UUID")
    .allowExcessArguments(false)
    .action(async (draftId: string) => {
      const service = new ReviewService({
        drafts: new DraftStore(),
        github: new GitHubClient(),
        youVersionAiApproved: false,
      });
      await service.post(draftId);
      console.log(`Posted public review from draft ${draftId}.`);
    });

  program
    .command("discard")
    .description("Delete a pending public review draft without posting it.")
    .argument("<draft-id>", "Pending draft UUID")
    .allowExcessArguments(false)
    .action(async (draftId: string) => {
      const service = new ReviewService({
        drafts: new DraftStore(),
        github: new GitHubClient(),
        youVersionAiApproved: false,
      });
      const discarded = await service.discard(draftId);
      console.log(discarded ? `Discarded draft ${draftId}.` : `Draft ${draftId} was already absent.`);
    });

  return program;
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync([...argv]);
  } catch (error) {
    const code = error instanceof SelahError ? error.code : "UNEXPECTED";
    console.error(`Selah error [${code}]: ${safeErrorMessage(error)}`);
    process.exitCode = error instanceof SelahError ? error.exitCode : 1;
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  await main();
}
