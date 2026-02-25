/**
 * Git working tree status.
 *
 * Returns porcelain v2 output for machine-readable parsing.
 */

import { z } from "zod";
import { gitExec } from "./exec.js";

export const schema = z.object({});

export const description =
  "Show git working tree status (staged, unstaged, untracked files)";

export async function handler(): Promise<string> {
  return gitExec(["status", "--porcelain=v2", "--branch"]);
}
