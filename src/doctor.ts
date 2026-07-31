import type { SelahConfig } from "./config.js";
import type { GitHubClient } from "./github.js";

export interface AccessChecker {
  checkAccess(): Promise<void>;
}

export interface BibleAccessChecker {
  checkBibleAccess(): Promise<void>;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "blocked";
  detail: string;
}

export interface DoctorResult {
  ready: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(
  config: SelahConfig,
  github: GitHubClient,
  gloo?: AccessChecker,
  youVersion?: BibleAccessChecker,
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const hasGlooCredentials = Boolean(config.glooClientId && config.glooClientSecret);
  checks.push({
    name: "Gloo credentials",
    status: hasGlooCredentials ? "pass" : "fail",
    detail: hasGlooCredentials ? "Required environment variables are present." : "Set GLOO_CLIENT_ID and GLOO_CLIENT_SECRET.",
  });

  if (hasGlooCredentials && gloo) {
    try {
      await gloo.checkAccess();
      checks.push({ name: "Gloo access", status: "pass", detail: "OAuth2 client credentials are accepted." });
    } catch {
      checks.push({ name: "Gloo access", status: "fail", detail: "OAuth2 access validation failed." });
    }
  } else {
    checks.push({ name: "Gloo access", status: "fail", detail: "Skipped because credentials are incomplete." });
  }

  try {
    await github.checkAuth();
    checks.push({ name: "GitHub CLI", status: "pass", detail: "gh authentication is valid." });
  } catch {
    checks.push({ name: "GitHub CLI", status: "fail", detail: "Run gh auth login to restore authentication." });
  }

  const hasYouVersionKey = Boolean(config.youVersionAppKey);
  checks.push({
    name: "YouVersion key",
    status: hasYouVersionKey ? "pass" : "fail",
    detail: hasYouVersionKey ? "YOUVERSION_APP_KEY is present." : "Set YOUVERSION_APP_KEY before enabling live retrieval.",
  });

  if (!config.youVersionAiApproved) {
    checks.push({
      name: "YouVersion access",
      status: "blocked",
      detail: "Disabled until SELAH_YOUVERSION_AI_APPROVED=true confirms written AI-use approval.",
    });
  } else if (!config.youVersionAppKey || !youVersion) {
    checks.push({ name: "YouVersion access", status: "fail", detail: "Set YOUVERSION_APP_KEY." });
  } else {
    try {
      await youVersion.checkBibleAccess();
      checks.push({
        name: "YouVersion access",
        status: "pass",
        detail: `Bible ${config.bibleId} and its attribution metadata are accessible.`,
      });
    } catch {
      checks.push({
        name: "YouVersion access",
        status: "fail",
        detail: `Bible ${config.bibleId} access validation failed.`,
      });
    }
  }

  return { ready: checks.every((check) => check.status === "pass"), checks };
}
