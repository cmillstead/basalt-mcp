/**
 * Error handling utilities.
 *
 * Never expose raw error messages to the AI — they leak
 * system paths, permissions, and OS details.
 */

import { ValidationError } from "./validation.js";

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  ELOOP: "Cannot write to a symbolic link",
  ENOENT: "File not found",
  EACCES: "Permission denied",
  EISDIR: "Expected a file, got a directory",
};

export function sanitizeError(error: unknown, fallback: string): string {
  if (error instanceof ValidationError) {
    return error.message;
  }

  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code in KNOWN_ERROR_MESSAGES) {
      return KNOWN_ERROR_MESSAGES[code];
    }
  }

  // Log the real error for debugging, return generic message
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[basalt-mcp] ${fallback}: ${detail}`);
  return fallback;
}
