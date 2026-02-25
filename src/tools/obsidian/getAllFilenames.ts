/**
 * List all vault files sorted by modification time.
 *
 * Excludes dotfiles, dotdirs, and symlinks.
 */

import path from "node:path";
import fs from "node:fs";
import { glob } from "glob";
import { z } from "zod";
import { getVaultPath, assertInsideVault } from "../../core/index.js";

export const schema = z.object({});

export const description =
  "List all filenames in the vault, sorted by most recently modified";

export async function handler(): Promise<string[]> {
  const vaultPath = getVaultPath();

  // glob with dot:false excludes dotfiles/dotdirs, follow:false ignores symlinks
  const matches = await glob("**/*", {
    cwd: vaultPath,
    nodir: true,
    dot: false,
    follow: false,
    absolute: true,
  });

  // Defense in depth: filter out symlinks and paths outside vault
  const files: Array<{ relative: string; mtimeMs: number }> = [];

  for (const absPath of matches) {
    try {
      assertInsideVault(absPath, vaultPath);
      const stat = fs.lstatSync(absPath);
      if (stat.isSymbolicLink()) continue;
      files.push({
        relative: path.relative(vaultPath, absPath),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Skip files that fail validation (outside vault, broken, etc.)
      continue;
    }
  }

  // Sort by most recently modified first
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files.map((f) => f.relative);
}
