/**
 * List vault files filtered by folder and/or extension.
 *
 * Reuses getAllFilenames (inherits symlink/dotfile exclusion),
 * then applies folder and extension filters. Returns only
 * filenames — no file content. Trusted output.
 */

import path from "node:path";
import { z } from "zod";
import {
  getVaultPath,
  ValidationError,
  assertNoNullBytes,
  assertNoDotPaths,
  assertPathLimits,
  assertInsideVault,
} from "../../core/index.js";
import { handler as getAllFilenames } from "./getAllFilenames.js";

export const schema = z.object({
  folder: z
    .string()
    .optional()
    .describe("Subfolder to list (relative to vault root)"),
  extension: z
    .string()
    .optional()
    .describe('Filter by file extension (e.g., ".md")'),
});

export const description =
  "List vault files filtered by folder and/or extension. " +
  "Returns only filenames (no file content). Output is server-generated and trusted.";

export type Input = z.infer<typeof schema>;

export async function handler(input: Input): Promise<string[]> {
  const vaultPath = getVaultPath();

  let allFiles = await getAllFilenames();

  // Validate and filter by folder
  if (input.folder !== undefined && input.folder !== "." && input.folder !== "") {
    assertNoNullBytes(input.folder);
    assertNoDotPaths(input.folder);
    assertPathLimits(input.folder);
    const absFolder = path.resolve(vaultPath, input.folder);
    assertInsideVault(absFolder, vaultPath);

    const folderPrefix = path.relative(vaultPath, absFolder);
    allFiles = allFiles.filter((f) => f.startsWith(folderPrefix + "/"));
  }

  // Validate and filter by extension
  if (input.extension !== undefined) {
    assertNoNullBytes(input.extension);
    if (!input.extension.startsWith(".")) {
      throw new ValidationError('Extension must start with a dot (e.g., ".md")');
    }
    const ext = input.extension.toLowerCase();
    allFiles = allFiles.filter((f) => f.toLowerCase().endsWith(ext));
  }

  return allFiles;
}
