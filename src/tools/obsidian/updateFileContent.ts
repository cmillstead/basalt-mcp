/**
 * Create or overwrite a file in the vault.
 *
 * Runs the full 9-step write validation chain before
 * touching the filesystem. See security-playbook.md.
 *
 * 1. assertNoNullBytes       — reject \0
 * 2. assertNoDotPaths        — reject dot-prefixed segments
 * 3. assertAllowedExtension  — allowlist only
 * 4. assertPathLimits        — max 512 chars, max 10 depth
 * 5. path.resolve            — normalize to absolute
 * 6. assertInsideVault       — must be inside vault
 * 7. mkdirSync               — create parent dirs
 * 8. assertNoSymlinkedParents — walk up, lstat each dir
 * 9. fs.openSync(O_NOFOLLOW) — atomic symlink rejection on final file
 */

import path from "node:path";
import fs from "node:fs";
import { constants } from "node:fs";
import { z } from "zod";
import {
  MAX_CONTENT_LENGTH,
  getVaultPath,
  assertNoNullBytes,
  assertNoDotPaths,
  assertAllowedExtension,
  assertPathLimits,
  assertInsideVault,
  assertNoSymlinkedParents,
  sanitizeError,
} from "../../core/index.js";

export const schema = z.object({
  filePath: z.string().describe("Path relative to vault root"),
  content: z
    .string()
    .max(MAX_CONTENT_LENGTH)
    .describe("File content to write"),
});

export const description = "Create or update a file in the vault";

export type Input = z.infer<typeof schema>;

export async function handler(input: Input): Promise<string> {
  const vaultPath = getVaultPath();

  try {
    // 1. Null byte rejection
    assertNoNullBytes(input.filePath);

    // 2. Dot-path rejection
    assertNoDotPaths(input.filePath);

    // 3. Extension allowlist
    assertAllowedExtension(input.filePath);

    // 4. Path length and depth limits
    assertPathLimits(input.filePath);

    // 5. Resolve to absolute path
    const fullPath = path.resolve(vaultPath, input.filePath);

    // 6. Vault containment check
    assertInsideVault(fullPath, vaultPath);

    // 7. Create parent directories
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // 8. Symlinked parent directory check
    assertNoSymlinkedParents(fullPath, vaultPath);

    // 9. Atomic write with O_NOFOLLOW — rejects symlink at final component
    const flags =
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(fullPath, flags, 0o644);
      fs.writeSync(fd, input.content);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const existed = input.filePath; // path we wrote to
    return `Successfully wrote ${existed}`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      return "Cannot write to a symbolic link";
    }
    return sanitizeError(err, "Failed to write file");
  }
}
