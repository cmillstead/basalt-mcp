import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handler } from "../../../src/tools/git/gitStatus.js";
import { setupGitRepo, teardownGitRepo, touch, gitCmd } from "./helpers.js";

beforeEach(() => setupGitRepo());
afterEach(() => teardownGitRepo());

describe("gitStatus", () => {
  it("shows clean working tree", async () => {
    const result = await handler();
    // Porcelain v2 with --branch always has header lines
    expect(result).toContain("# branch.oid");
  });

  it("shows untracked files", async () => {
    touch("newfile.ts", "new content");

    const result = await handler();
    expect(result).toContain("newfile.ts");
  });

  it("shows staged changes", async () => {
    touch("file1.ts", "modified content");
    gitCmd("add", "file1.ts");

    const result = await handler();
    expect(result).toContain("file1.ts");
  });

  it("shows unstaged modifications", async () => {
    touch("file1.ts", "unstaged change");

    const result = await handler();
    expect(result).toContain("file1.ts");
  });
});
