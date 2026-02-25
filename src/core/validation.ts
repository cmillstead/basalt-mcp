/**
 * Core input validation and path security.
 *
 * Every filesystem operation flows through these assertions.
 * See SECURITY.md for the full threat model.
 *
 * WRITE VALIDATION CHAIN (9 steps, order matters):
 *   1. assertNoNullBytes      - Block C-level path truncation
 *   2. assertNoDotPaths       - Block .git, .obsidian access
 *   3. assertAllowedExtension - Allowlist only (.md, .canvas)
 *   4. assertPathLimits       - Max 512 chars, 10 depth
 *   5. path.resolve()         - Normalize AFTER string checks
 *   6. assertInsideVault      - Enforce boundary with path.sep
 *   7. mkdirSync              - Create parents for symlink walk
 *   8. assertNoSymlinkedParents - Walk up, lstat each dir
 *   9. O_NOFOLLOW open        - Kernel-level symlink rejection
 *
 * WHY THIS ORDER:
 *   - Null bytes first: C APIs truncate at \0
 *   - Dot-paths before ext: ".git/hooks/x" fails at step 2
 *   - String checks before resolve(): resolve() normalizes ../..
 *   - O_NOFOLLOW last: atomic, immune to TOCTOU races
 */

import path from "node:path";
import fs from "node:fs";

/** Allowlist of extensions. Prevents double-ext bypasses like .md.js */
const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".canvas",
]);

/** Max path length to prevent DoS via filesystem limits */
const MAX_PATH_LENGTH = 512;

/** Max directory depth to prevent depth bomb attacks */
const MAX_DIRECTORY_DEPTH = 10;

/** Max file size for reads (10MB) to prevent memory exhaustion */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Max content size for writes (1MB) */
const MAX_CONTENT_LENGTH = 1_000_000; // 1MB write limit

/**
 * Error class for validation failures.
 * Messages are safe to return to the AI (no system details).
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Block null byte injection. C APIs treat \0 as string terminator,
 * so "secret.md\0.txt" could bypass extension checks.
 */
export function assertNoNullBytes(filePath: string): void {
  if (filePath.includes("\0")) {
    throw new ValidationError("Invalid path: null bytes are not allowed");
  }
}

/**
 * Block dot-prefixed files/dirs. Per-segment check catches:
 * - .git/hooks/pre-commit (code execution)
 * - .obsidian/plugins/x/main.js (Obsidian execution)
 * - nested: notes/.secret/data.md
 */
export function assertNoDotPaths(filePath: string): void {
  const segments = filePath.split(path.sep);
  for (const seg of segments) {
    if (seg.startsWith(".")) {
      throw new ValidationError(
        "Invalid path: dot-prefixed names are not allowed"
      );
    }
  }
}

/**
 * Enforce extension allowlist. path.extname(".md.js") returns ".js",
 * catching double-extension bypasses.
 */
export function assertAllowedExtension(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Invalid file extension: "${ext}" is not allowed`
    );
  }
}

/** Block DoS via long paths or deeply nested directories. */
export function assertPathLimits(filePath: string): void {
  if (filePath.length > MAX_PATH_LENGTH) {
    throw new ValidationError(
      `Path exceeds maximum length of ${MAX_PATH_LENGTH} characters`
    );
  }
  const depth = filePath.split(path.sep).filter(Boolean).length;
  if (depth > MAX_DIRECTORY_DEPTH) {
    throw new ValidationError(
      `Path exceeds maximum depth of ${MAX_DIRECTORY_DEPTH} directories`
    );
  }
}

/**
 * Enforce vault boundary. Uses vaultPath + path.sep to prevent
 * prefix collision: "/tmp/vault" vs "/tmp/vault-evil".
 */
export function assertInsideVault(
  fullPath: string,
  vaultPath: string
): void {
  if (!fullPath.startsWith(vaultPath + path.sep) && fullPath !== vaultPath) {
    throw new ValidationError("Path is outside the vault");
  }
}

/**
 * Walk from file to vault root, verify no parent is a symlink.
 * Uses lstatSync (not statSync) to detect symlinks.
 * Layer 2 of 3-layer symlink defense (glob, walk, O_NOFOLLOW).
 */
export function assertNoSymlinkedParents(
  fullPath: string,
  vaultPath: string
): void {
  let current = path.dirname(fullPath);
  while (current !== vaultPath && current.startsWith(vaultPath)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new ValidationError(
        "Cannot access paths through symbolic links"
      );
    }
    current = path.dirname(current);
  }
}

/** Enforce file size limit to prevent memory exhaustion on reads. */
export function assertFileSize(filePath: string): void {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new ValidationError(
      `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`
    );
  }
}

/**
 * Safely read a file after validating containment, symlinks, and size.
 * Throws on symlinks, vault escape, or oversized files.
 * Used by readMultipleFiles, getOpenTodos, and searchVault.
 */
export function readSafeFile(absPath: string, basePath: string): string {
  assertInsideVault(absPath, basePath);
  assertNoSymlinkedParents(absPath, basePath);

  const stat = fs.lstatSync(absPath);
  if (stat.isSymbolicLink()) {
    throw new ValidationError("Cannot read symbolic links");
  }

  assertFileSize(absPath);
  return fs.readFileSync(absPath, "utf-8");
}

export {
  ALLOWED_EXTENSIONS,
  MAX_PATH_LENGTH,
  MAX_DIRECTORY_DEPTH,
  MAX_FILE_SIZE,
  MAX_CONTENT_LENGTH,
};
