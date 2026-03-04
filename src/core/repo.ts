/**
 * Repository path management.
 *
 * Same pattern as vault.ts — resolved once at startup,
 * exposed via an immutable getter. Additionally validates
 * that the path is a git repository.
 */

import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let resolvedRepoPath: string | null = null;

export function validateRepoPath(inputPath: string): string {
  if (!inputPath) {
    throw new Error("Repo path is required");
  }

  const absolute = path.resolve(inputPath);

  if (!fs.existsSync(absolute)) {
    throw new Error("Repo path does not exist");
  }

  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) {
    throw new Error("Repo path must be a directory");
  }

  // Verify it's a git repo
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: absolute,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Repo path is not a git repository");
  }

  // Resolve symlinks for canonical path
  return fs.realpathSync(absolute);
}

export function initRepo(inputPath: string): string {
  resolvedRepoPath = validateRepoPath(inputPath);
  return resolvedRepoPath;
}

export function getRepoPath(): string {
  if (!resolvedRepoPath) {
    throw new Error("Repo path has not been initialized");
  }
  return resolvedRepoPath;
}

export function hasRepoPath(): boolean {
  return resolvedRepoPath !== null;
}
