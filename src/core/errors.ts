/**
 * Error handling utilities.
 *
 * Never expose raw error messages to the AI - they leak
 * system paths, permissions, and OS details.
 *
 * Structured logging format (JSON to stderr):
 *   { level, msg, code?, detail?, ts }
 *
 * - ValidationError: Safe to return to AI (user-facing message)
 * - Known errno codes: Mapped to safe, non-leaking messages
 * - Unknown errors: Logged with detail, generic message returned
 */

import { ValidationError } from "./validation.js";

/** Known errno codes mapped to safe, non-leaking error messages */
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  ELOOP: "Cannot write to a symbolic link",
  ENOENT: "File not found",
  EACCES: "Permission denied",
  EISDIR: "Expected a file, got a directory",
};

/**
 * Log a structured JSON message to stderr.
 * JSON format enables parsing by log aggregators (CloudWatch, Datadog, etc.)
 */
function logError(msg: string, detail?: string, code?: string): void {
  const entry: Record<string, unknown> = {
    level: "error",
    msg,
    ts: new Date().toISOString(),
  };
  if (code) entry.code = code;
  if (detail) entry.detail = detail.replace(/\/[^\s:,]+/g, "<path>");
  console.error(JSON.stringify(entry));
}

/**
 * Sanitize an error for safe return to the AI.
 *
 * Strategy:
 * 1. ValidationError - already safe, return message directly
 * 2. Known errno - return mapped message (no system details)
 * 3. Unknown - log detail to stderr, return generic fallback
 *
 * @param error - The caught error (unknown type)
 * @param fallback - Generic message to return for unknown errors
 * @returns Safe error message for the AI
 */
export function sanitizeError(error: unknown, fallback: string): string {
  // ValidationError messages are designed to be safe for AI consumption
  if (error instanceof ValidationError) {
    return error.message;
  }

  // Map known errno codes to safe messages
  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code in KNOWN_ERROR_MESSAGES) {
      return KNOWN_ERROR_MESSAGES[code];
    }
  }

  // Unknown error: log full detail for debugging, return generic message
  const detail = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  logError(fallback, detail, code ?? undefined);
  return fallback;
}
