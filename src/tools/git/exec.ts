/**
 * Safe git command execution.
 *
 * Uses execFileSync (no shell) with cwd locked to the repo path.
 * Strips the repo path from output to prevent information leakage.
 * Caps output at 100KB to prevent memory exhaustion.
 *
 * Defends against malicious .git/config by overriding all config
 * options that execute external commands (-c flags have highest
 * precedence) and by sanitizing the environment to prevent
 * system/global config and env-based config injection.
 *
 * See: CVE-2022-24765, CVE-2024-32002, CVE-2025-48384
 */

import { execFileSync } from "node:child_process";
import { getRepoPath, sanitizeError } from "../../core/index.js";

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

const SAFE_REF_PATTERN = /^[a-zA-Z0-9_.\\/\-~^@{}:]+$/;

/**
 * Git -c overrides to neutralize all known config options that
 * execute external commands. Setting to empty string disables them.
 * -c has the highest config precedence — overrides .git/config.
 */
const CONFIG_OVERRIDES = [
  "-c", "core.fsmonitor=",          // Fires on status/diff — #1 threat
  "-c", "core.hooksPath=",          // Redirects hooks directory
  "-c", "core.sshCommand=",         // SSH transport command
  "-c", "core.askPass=",            // Password prompt program
  "-c", "core.gitProxy=",           // Git protocol proxy command
  "-c", "core.editor=",             // Editor execution
  "-c", "core.pager=",              // Pager execution (also --no-pager)
  "-c", "sequence.editor=",         // Interactive rebase editor
  "-c", "diff.external=",           // External diff program
  "-c", "credential.helper=",       // Credential helper execution
  "-c", "filter.a.clean=",          // Filter driver (clean)
  "-c", "filter.a.smudge=",         // Filter driver (smudge)
  "-c", "filter.a.process=",        // Filter driver (long-running)
  "-c", "sendemail.sendmailCmd=",   // Email sending command
  "-c", "sendemail.toCmd=",         // Email recipient generation
  "-c", "sendemail.ccCmd=",         // Email CC generation
];

/**
 * Environment variables that prevent system/global config loading
 * and neutralize env-based overrides for command-executing options.
 */
const SAFE_ENV: Record<string, string> = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",         // Skip /etc/gitconfig
  GIT_CONFIG_GLOBAL: "/dev/null",   // Skip ~/.gitconfig
  GIT_TERMINAL_PROMPT: "0",         // Prevent interactive prompts
  GIT_CONFIG_COUNT: "0",            // Prevent env-based config injection
  GIT_ASKPASS: "",                   // Neutralize env askpass override
  GIT_SSH_COMMAND: "",               // Neutralize env SSH override
  GIT_EDITOR: "",                    // Neutralize env editor override
  GIT_PAGER: "",                     // Neutralize env pager override
  GIT_EXTERNAL_DIFF: "",             // Neutralize env diff override
};

export function assertSafeRef(ref: string): void {
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error("Invalid git ref: contains disallowed characters");
  }
}

export function gitExec(args: string[]): string {
  const repoPath = getRepoPath();

  try {
    const result = execFileSync("git", [
      "--no-pager",
      ...CONFIG_OVERRIDES,
      ...args,
    ], {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: SAFE_ENV,
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
