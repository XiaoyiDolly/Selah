import { spawn } from "node:child_process";

import { SelahError } from "./errors.js";
import { redactText } from "./redaction.js";
import type { RepositoryRef } from "./schemas.js";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: { input?: string; timeoutMs?: number },
) => Promise<ProcessResult>;

export class ProcessRunError extends Error {
  constructor(
    message: string,
    readonly outcome: "not_started" | "uncertain",
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProcessRunError";
  }
}

export function scrubProviderEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed = { ...environment };
  delete scrubbed.GLOO_CLIENT_ID;
  delete scrubbed.GLOO_CLIENT_SECRET;
  delete scrubbed.YOUVERSION_APP_KEY;
  return scrubbed;
}

export const runProcess: ProcessRunner = async (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: scrubProviderEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    let forceKill: NodeJS.Timeout | undefined;
    const maximumOutputBytes = 512 * 1024;
    const terminate = (): void => {
      if (forceKill) return;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? 30_000);

    const collect = (chunks: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      reject(new ProcessRunError(`${command} could not be started.`, "not_started", { cause: error }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (timedOut) {
        reject(new ProcessRunError(`${command} timed out after it started.`, "uncertain"));
        return;
      }
      if (outputExceeded) {
        reject(new ProcessRunError(`${command} exceeded its output limit after it started.`, "uncertain"));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    child.stdin.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      terminate();
      reject(new ProcessRunError(`${command} failed while receiving its input.`, "uncertain", { cause: error }));
    });
    child.stdin.end(options.input);
  });

export function parsePullRequestUrl(rawUrl: string): RepositoryRef {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new SelahError("INPUT_INVALID", "PR URL must be a valid GitHub pull request URL.", {
      cause: error,
    });
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new SelahError("INPUT_INVALID", "PR URL must be an HTTPS github.com URL without credentials or query data.");
  }

  const match = /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9]\d*)\/?$/u.exec(
    url.pathname,
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new SelahError("INPUT_INVALID", "PR URL must match https://github.com/owner/repository/pull/number.");
  }

  const owner = match[1];
  const name = match[2];
  const pullNumber = Number(match[3]);
  if (!Number.isSafeInteger(pullNumber)) {
    throw new SelahError("INPUT_INVALID", "Pull request number is too large.");
  }

  return {
    owner,
    name,
    pullNumber,
    url: `https://github.com/${owner}/${name}/pull/${pullNumber}`,
  };
}

export class GitHubClient {
  constructor(private readonly runner: ProcessRunner = runProcess) {}

  async checkAuth(): Promise<void> {
    let result: ProcessResult;
    try {
      result = await this.runner("gh", ["auth", "status"], { timeoutMs: 15_000 });
    } catch (error) {
      throw new SelahError("GITHUB_AUTH", "Unable to run gh auth status.", { cause: error });
    }
    if (result.exitCode !== 0) {
      throw new SelahError("GITHUB_AUTH", "GitHub CLI authentication is unavailable or invalid.");
    }
  }

  async postReview(repository: RepositoryRef, body: string): Promise<void> {
    let result: ProcessResult;
    try {
      result = await this.runner(
        "gh",
        ["pr", "review", repository.url, "--comment", "--body-file", "-"],
        { input: body, timeoutMs: 30_000 },
      );
    } catch (error) {
      if (error instanceof ProcessRunError && error.outcome === "uncertain") {
        throw new SelahError(
          "GITHUB_POST_UNCERTAIN",
          "GitHub review outcome is uncertain. Inspect the PR before taking any further action; this draft cannot be retried.",
          { cause: error },
        );
      }
      throw new SelahError("GITHUB_POST", "GitHub review posting failed before it could start.", {
        cause: error,
      });
    }
    if (result.exitCode !== 0) {
      const safeDetail = redactText(result.stderr).trim().slice(0, 300);
      throw new SelahError(
        "GITHUB_POST",
        safeDetail ? `GitHub rejected the review: ${safeDetail}` : "GitHub rejected the review.",
      );
    }
  }
}
