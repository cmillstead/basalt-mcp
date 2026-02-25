/**
 * Safe git command execution.
 *
 * Uses execFileSync (no shell) with cwd locked to the repo path.
 * Strips the repo path from output to prevent information leakage.
 * Caps output at 100KB to prevent memory exhaustion.
 */

import { execFileSync } from "node:child_process";
import { getRepoPath, sanitizeError } from "../../core/index.js";

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

const SAFE_REF_PATTERN = /^[a-zA-Z0-9_.\\/\-~^@{}:]+$/;

export function assertSafeRef(ref: string): void {
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error("Invalid git ref: contains disallowed characters");
  }
}

export function gitExec(args: string[]): string {
  const repoPath = getRepoPath();

  try {
    const result = execFileSync("git", ["--no-pager", ...args], {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Strip absolute repo path from output to prevent leakage
    return result.replaceAll(repoPath, ".");
  } catch (err) {
    // execFileSync throws on non-zero exit — git diff returns 1 when there are changes
    if (err && typeof err === "object" && "stdout" in err) {
      const output = (err as { stdout: string }).stdout;
      if (typeof output === "string" && output.length > 0) {
        return output.replaceAll(repoPath, ".");
      }
    }

    throw new Error(sanitizeError(err, "Git command failed"));
  }
}
