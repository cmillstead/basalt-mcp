/**
 * Vault path management.
 *
 * The vault path is resolved once at startup and exposed via
 * an immutable getter. Throws if accessed before initialization.
 */

import path from "node:path";
import fs from "node:fs";

let resolvedVaultPath: string | null = null;

export function validateVaultPath(inputPath: string): string {
  if (!inputPath) {
    throw new Error("Vault path is required");
  }

  const absolute = path.resolve(inputPath);

  if (!fs.existsSync(absolute)) {
    throw new Error(`Vault path does not exist: ${absolute}`);
  }

  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) {
    throw new Error("Vault path must be a directory");
  }

  // Resolve symlinks for canonical path
  return fs.realpathSync(absolute);
}

export function initVault(inputPath: string): string {
  resolvedVaultPath = validateVaultPath(inputPath);
  return resolvedVaultPath;
}

export function getVaultPath(): string {
  if (!resolvedVaultPath) {
    throw new Error("Vault path has not been initialized");
  }
  return resolvedVaultPath;
}
