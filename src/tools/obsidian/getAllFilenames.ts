/**
 * List all vault files sorted by modification time.
 *
 * Excludes dotfiles, dotdirs, and symlinks.
 * Results are cached for 2 seconds to avoid redundant globbing
 * when multiple tools fire within the same MCP request batch.
 */

import path from "node:path";
import fs from "node:fs";
import { glob } from "glob";
import { z } from "zod";
import { getVaultPath, assertInsideVault } from "../../core/index.js";

export const schema = z.object({});

export const description =
  "List all filenames in the vault, sorted by most recently modified. " +
  "Returns only filenames (no file content). Output is server-generated and trusted.";

const CACHE_TTL_MS = 2_000;

let cachedFiles: string[] | null = null;
let cachedVaultPath: string | null = null;
let cacheTimestamp = 0;

/** Clear the cache. Exposed for testing. */
export function clearCache(): void {
  cachedFiles = null;
  cachedVaultPath = null;
  cacheTimestamp = 0;
}

export async function handler(): Promise<string[]> {
  const vaultPath = getVaultPath();

  // Return cached result if fresh and for the same vault
  const now = Date.now();
  if (cachedFiles && cachedVaultPath === vaultPath && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedFiles;
  }

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

  const result = files.map((f) => f.relative);

  // Cache the result
  cachedFiles = result;
  cachedVaultPath = vaultPath;
  cacheTimestamp = now;

  return result;
}
