/**
 * Git blame for a file.
 *
 * Full path validation before execution — null bytes, vault
 * containment, symlinked parents. Uses -- separator to prevent
 * flag injection via filename.
 */

import path from "node:path";
import { z } from "zod";
import {
  getRepoPath,
  assertNoNullBytes,
  assertInsideVault,
  assertNoSymlinkedParents,
} from "../../core/index.js";
import { gitExec } from "./exec.js";

export const schema = z.object({
  filePath: z.string().describe("File path relative to vault root"),
});

export const description = "Show git blame (per-line authorship) for a file";

export type Input = z.infer<typeof schema>;

export async function handler(input: Input): Promise<string> {
  const vaultPath = getRepoPath();

  assertNoNullBytes(input.filePath);

  const fullPath = path.resolve(vaultPath, input.filePath);
  assertInsideVault(fullPath, vaultPath);
  assertNoSymlinkedParents(fullPath, vaultPath);

  // -- separator prevents filePath from being interpreted as a flag
  return gitExec(["blame", "--", input.filePath]);
}
