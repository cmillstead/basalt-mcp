/**
 * Scan markdown files for unchecked todo items (- [ ]).
 *
 * Excludes dotfiles, symlinks, and files over 10MB.
 */

import { z } from "zod";

export const schema = z.object({});

export const description = "Find all open todo items (- [ ]) across vault markdown files";

export interface TodoItem {
  file: string;
  line: number;
  text: string;
}

export async function handler(): Promise<TodoItem[]> {
  // TODO: implement
  return [];
}
