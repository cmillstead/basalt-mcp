/**
 * Shared helpers for git tool tests.
 *
 * Creates a real temp git repo with commits for each test.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { initRepo } from "../../../src/core/index.js";

export let repoDir: string;

export function gitCmd(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function touch(relativePath: string, content = ""): void {
  const full = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

export function setupGitRepo(): void {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-git-test-"));

  gitCmd("init");
  gitCmd("config", "user.email", "test@test.com");
  gitCmd("config", "user.name", "Test User");

  // Initial commit
  touch("file1.ts", "const x = 1;\n");
  touch("file2.ts", "const y = 2;\n");
  gitCmd("add", ".");
  gitCmd("commit", "-m", "initial commit");

  // Second commit
  touch("file1.ts", "const x = 1;\nconst z = 3;\n");
  gitCmd("add", ".");
  gitCmd("commit", "-m", "add z variable");

  initRepo(repoDir);
}

export function teardownGitRepo(): void {
  fs.rmSync(repoDir, { recursive: true, force: true });
}
