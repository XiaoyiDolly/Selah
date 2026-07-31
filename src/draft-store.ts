import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { isErrno, SelahError } from "./errors.js";
import { parsePullRequestUrl } from "./github.js";
import {
  PendingDraftSchema,
  type PendingDraft,
  type PublicReview,
  type RepositoryRef,
} from "./schemas.js";

const DRAFT_TTL_MS = 30 * 60 * 1_000;
const MAX_DRAFT_FILE_BYTES = 64 * 1024;
const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface DraftStoreOptions {
  baseDirectory?: string;
  now?: () => Date;
  idFactory?: () => string;
}

export interface DraftClaim {
  draft: PendingDraft;
  claimPath: string;
}

export class DraftStore {
  private readonly baseDirectory: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: DraftStoreOptions = {}) {
    this.baseDirectory = options.baseDirectory ?? join(tmpdir(), "selah-pr-review");
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async create(repository: RepositoryRef, publicReview: PublicReview): Promise<PendingDraft> {
    await this.ensureDirectory();
    await this.cleanupExpired();
    const draftId = this.idFactory();
    this.validateDraftId(draftId);
    const createdAt = this.now();
    const draft = PendingDraftSchema.parse({
      version: 1,
      draftId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + DRAFT_TTL_MS).toISOString(),
      repository: {
        owner: repository.owner,
        name: repository.name,
        pullNumber: repository.pullNumber,
        url: repository.url,
      },
      publicReview: { body: publicReview.body },
    });

    const path = this.draftPath(draftId);
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(draft)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    await chmod(path, 0o600);
    return draft;
  }

  async load(draftId: string): Promise<PendingDraft> {
    this.validateDraftId(draftId);
    await this.ensureDirectory();
    await this.cleanupExpired(draftId);
    return this.readDraft(this.draftPath(draftId), draftId, true);
  }

  async claim(draftId: string): Promise<DraftClaim> {
    this.validateDraftId(draftId);
    await this.ensureDirectory();
    await this.cleanupExpired(draftId);
    const source = this.draftPath(draftId);
    const claimPath = this.claimPath(draftId);
    await this.readDraft(source, draftId, true);
    try {
      await rename(source, claimPath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new SelahError("DRAFT_NOT_FOUND", "Draft does not exist or is already being posted.");
      }
      throw error;
    }

    try {
      const draft = await this.readDraft(claimPath, draftId, false);
      return { draft, claimPath };
    } catch (error) {
      if (error instanceof SelahError && error.code === "DRAFT_EXPIRED") {
        await unlink(claimPath).catch(() => undefined);
      } else {
        await rename(claimPath, source).catch(() => undefined);
      }
      throw error;
    }
  }

  async completeClaim(claim: DraftClaim): Promise<void> {
    await unlink(claim.claimPath);
  }

  async releaseClaim(claim: DraftClaim): Promise<void> {
    await rename(claim.claimPath, this.draftPath(claim.draft.draftId));
  }

  async discard(draftId: string): Promise<boolean> {
    this.validateDraftId(draftId);
    await this.ensureDirectory();
    await this.cleanupExpired();
    try {
      await unlink(this.draftPath(draftId));
      return true;
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        try {
          await lstat(this.claimPath(draftId));
          throw new SelahError("DRAFT_NOT_FOUND", "Draft is currently being posted and cannot be discarded.");
        } catch (claimError) {
          if (claimError instanceof SelahError) {
            throw claimError;
          }
          if (isErrno(claimError, "ENOENT")) {
            return false;
          }
          throw claimError;
        }
      }
      throw error;
    }
  }

  async cleanupExpired(excludedDraftId?: string): Promise<void> {
    await this.ensureDirectory();
    const names = await readdir(this.baseDirectory);
    await Promise.all(
      names
        .map((name) => {
          const match = /^([0-9a-f-]+)\.(?:json|posting)$/u.exec(name);
          return match?.[1] && DRAFT_ID_PATTERN.test(match[1]) ? { name, draftId: match[1] } : undefined;
        })
        .filter((entry): entry is { name: string; draftId: string } =>
          Boolean(entry && entry.draftId !== excludedDraftId),
        )
        .map(async ({ name, draftId }) => {
          const path = join(this.baseDirectory, name);
          try {
            const draft = await this.readDraft(path, draftId, false);
            if (new Date(draft.expiresAt).getTime() <= this.now().getTime()) {
              await unlink(path);
            }
          } catch (error) {
            if (error instanceof SelahError && error.code === "DRAFT_EXPIRED") {
              await unlink(path).catch(() => undefined);
            }
          }
        }),
    );
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.baseDirectory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.baseDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new SelahError("DRAFT_INSECURE", "Draft location is not a secure directory.");
    }
    this.assertCurrentOwner(metadata.uid);
    await chmod(this.baseDirectory, 0o700);
  }

  private async readDraft(path: string, expectedId: string, removeExpired: boolean): Promise<PendingDraft> {
    let handle;
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new SelahError("DRAFT_INSECURE", "Draft is not a regular owner-only file.");
      }
      this.assertCurrentOwner(metadata.uid);
      if ((metadata.mode & 0o777) !== 0o600) {
        throw new SelahError("DRAFT_INSECURE", "Draft permissions must be 0600.");
      }
      if (metadata.size > MAX_DRAFT_FILE_BYTES) {
        throw new SelahError("DRAFT_INVALID", "Draft is oversized.");
      }
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const raw = await handle.readFile("utf8");
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new SelahError("DRAFT_INVALID", "Draft contains malformed JSON.", { cause: error });
      }
      const parsed = PendingDraftSchema.safeParse(json);
      if (!parsed.success || parsed.data.draftId !== expectedId) {
        throw new SelahError("DRAFT_INVALID", "Draft content does not match its identifier.");
      }
      this.assertDraftInvariants(parsed.data);
      if (new Date(parsed.data.expiresAt).getTime() <= this.now().getTime()) {
        if (removeExpired) {
          await handle.close();
          handle = undefined;
          await unlink(path).catch(() => undefined);
        }
        throw new SelahError("DRAFT_EXPIRED", "Draft has expired and cannot be posted.");
      }
      return parsed.data;
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new SelahError("DRAFT_NOT_FOUND", "Draft was not found.");
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private assertCurrentOwner(uid: number): void {
    if (typeof process.getuid === "function" && uid !== process.getuid()) {
      throw new SelahError("DRAFT_INSECURE", "Draft location is owned by another user.");
    }
  }

  private assertDraftInvariants(draft: PendingDraft): void {
    const createdAt = new Date(draft.createdAt).getTime();
    const expiresAt = new Date(draft.expiresAt).getTime();
    if (expiresAt - createdAt !== DRAFT_TTL_MS || createdAt > this.now().getTime()) {
      throw new SelahError("DRAFT_INVALID", "Draft timestamps violate the fixed 30-minute lifetime.");
    }
    let canonical: RepositoryRef;
    try {
      canonical = parsePullRequestUrl(draft.repository.url);
    } catch (error) {
      throw new SelahError("DRAFT_INVALID", "Draft repository target is invalid.", { cause: error });
    }
    if (
      canonical.owner !== draft.repository.owner ||
      canonical.name !== draft.repository.name ||
      canonical.pullNumber !== draft.repository.pullNumber ||
      canonical.url !== draft.repository.url
    ) {
      throw new SelahError("DRAFT_INVALID", "Draft repository identifiers do not match its canonical URL.");
    }
  }

  private validateDraftId(draftId: string): void {
    if (!DRAFT_ID_PATTERN.test(draftId)) {
      throw new SelahError("DRAFT_INVALID", "Draft ID must be a canonical UUID v4.");
    }
  }

  private draftPath(draftId: string): string {
    return join(this.baseDirectory, `${draftId}.json`);
  }

  private claimPath(draftId: string): string {
    return join(this.baseDirectory, `${draftId}.posting`);
  }
}
