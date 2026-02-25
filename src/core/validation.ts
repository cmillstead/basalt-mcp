/**
 * Core input validation and path security.
 *
 * Every filesystem operation flows through these assertions.
 * See security-playbook.md for the full threat model.
 */

import path from "node:path";
import fs from "node:fs";

const ALLOWED_EXTENSIONS = new Set([
  ".md",
  ".canvas",
]);

const MAX_PATH_LENGTH = 512;
const MAX_DIRECTORY_DEPTH = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CONTENT_LENGTH = 1_000_000; // 1MB write limit

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertNoNullBytes(filePath: string): void {
  if (filePath.includes("\0")) {
    throw new ValidationError("Invalid path: null bytes are not allowed");
  }
}

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

export function assertAllowedExtension(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Invalid file extension: "${ext}" is not allowed`
    );
  }
}

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

export function assertInsideVault(
  fullPath: string,
  vaultPath: string
): void {
  if (!fullPath.startsWith(vaultPath + path.sep) && fullPath !== vaultPath) {
    throw new ValidationError("Path is outside the vault");
  }
}

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
