/**
 * Content boundary markers for indirect prompt injection defense.
 *
 * Wraps untrusted content (file contents, git output) with randomized
 * delimiters so the AI can distinguish server metadata from user content.
 * Based on Microsoft's "spotlighting" technique.
 */

import crypto from "node:crypto";

/**
 * Generate a random boundary token.
 * Each call produces a fresh 32-char hex token to prevent prediction.
 */
export function generateBoundaryToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Wrap untrusted content with boundary markers.
 * The random token prevents content from forging a matching end marker.
 */
export function wrapUntrustedContent(content: string, token: string): string {
  return `<<<UNTRUSTED_CONTENT_${token}>>>\n${content}\n<<<END_UNTRUSTED_CONTENT_${token}>>>`;
}
