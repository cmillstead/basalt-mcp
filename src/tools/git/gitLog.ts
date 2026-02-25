/**
 * Git commit log.
 *
 * Returns recent commits with hash, author, date, and message.
 */

import { z } from "zod";
import { gitExec } from "./exec.js";

export const schema = z.object({
  maxCount: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of commits to return (1-100, default 20)"),
});

export const description = "Show git commit log";

export type Input = z.infer<typeof schema>;

export async function handler(input: Input): Promise<string> {
  return gitExec([
    "log",
    `--max-count=${input.maxCount}`,
    "--format=%H %ae %aI%n%s%n",
  ]);
}
