/**
 * Safe git command execution.
 *
 * Uses execFileSync (no shell) with cwd locked to the repo path.
 * Strips the repo path from output to prevent information leakage.
 * Caps output at 100KB to prevent memory exhaustion.
 *
 * Defends against malicious .git/config by overriding all config
 * options that execute external commands (-c flags have highest
 * precedence) and by using a minimal allowlist environment to prevent
 * secret leakage and env-based config injection.
 *
 * See: CVE-2022-24765, CVE-2024-32002, CVE-2025-48384
 */

import { execFileSync } from "node:child_process";
import { getRepoPath, ValidationError } from "../../core/index.js";

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

const SAFE_REF_PATTERN = /^[a-zA-Z0-9_.\\/\-~^@{}:]+$/;

/**
 * Git -c overrides to neutralize all known config options that
 * execute external commands. Setting to empty string disables them.
 * -c has the highest config precedence - overrides .git/config.
 */
const CONFIG_OVERRIDES = [
  "-c", "core.fsmonitor=",          // Fires on status/diff - #1 threat
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
  "-c", "log.showSignature=false",  // Prevent gpg.program invocation on git log
  "-c", "gpg.program=",             // Neutralize custom gpg binary
  "-c", "gpg.ssh.defaultKeyCommand=", // SSH signing variant
  "-c", "gpg.ssh.allowedSignersFile=", // SSH signing file reference
  "-c", "tag.gpgSign=false",        // Prevent signature verification on tags
];

/**
 * Minimal environment for git subprocess — only what git needs to run.
 * Does NOT spread process.env, so unlisted vars (API keys, tokens, secrets,
 * GIT_EXEC_PATH, GIT_DIR, GIT_OBJECT_DIRECTORY, etc.) are automatically
 * excluded from the subprocess environment without needing explicit clearing.
 * Setting GIT_DIR="" would break git; omitting it is the correct approach.
 */
const SAFE_ENV: Record<string, string> = {
  // Passthrough only the vars git actually needs to locate executables and temp space
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  TMP: process.env.TMP ?? "/tmp",
  TEMP: process.env.TEMP ?? "/tmp",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  LC_ALL: process.env.LC_ALL ?? "",
  // Skip system and user git config — always server-controlled
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  // Block env-based config injection via GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_*
  GIT_CONFIG_COUNT: "0",
  // Prevent interactive prompts
  GIT_TERMINAL_PROMPT: "0",
  // Neutralize env-based command overrides (empty string disables, unlike unset)
  GIT_ASKPASS: "",
  GIT_SSH_COMMAND: "",
  GIT_EDITOR: "",
  GIT_PAGER: "",
  GIT_EXTERNAL_DIFF: "",
};

export function assertSafeRef(ref: string): void {
  // Block path traversal sequences — git rejects them, but we reject
  // them earlier so the error type is ValidationError (safe for AI).
  if (ref.includes("../")) {
    throw new ValidationError("Invalid git ref: contains disallowed characters");
  }
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new ValidationError("Invalid git ref: contains disallowed characters");
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
    // execFileSync throws on non-zero exit - git diff returns 1 when there are changes
    if (err && typeof err === "object" && "stdout" in err) {
      const output = (err as { stdout: string }).stdout;
      if (typeof output === "string" && output.length > 0) {
        return output.replaceAll(repoPath, ".");
      }
    }

    throw new Error("Git command failed");
  }
}
