import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handler } from "../../../src/tools/git/gitDiff.js";
import { setupGitRepo, teardownGitRepo, touch, gitCmd } from "./helpers.js";

beforeEach(() => setupGitRepo());
afterEach(() => teardownGitRepo());

describe("gitDiff", () => {
  it("shows working tree changes", async () => {
    touch("file1.ts", "completely new content\n");

    const result = await handler({ staged: false });
    expect(result).toContain("file1.ts");
    expect(result).toContain("completely new content");
  });

  it("returns empty string for clean tree", async () => {
    const result = await handler({ staged: false });
    expect(result.trim()).toBe("");
  });

  it("shows staged changes with --cached", async () => {
    touch("file1.ts", "staged content\n");
    gitCmd("add", "file1.ts");

    const result = await handler({ staged: true });
    expect(result).toContain("staged content");
  });

  it("diffs against a ref", async () => {
    const result = await handler({ ref: "HEAD~1", staged: false });
    expect(result).toContain("const z = 3");
  });

  it("diffs against HEAD", async () => {
    touch("file2.ts", "modified\n");

    const result = await handler({ ref: "HEAD", staged: false });
    expect(result).toContain("file2.ts");
  });

  it("rejects unsafe ref with shell metacharacters", async () => {
    await expect(
      handler({ ref: "$(whoami)", staged: false })
    ).rejects.toThrow(/disallowed characters/);
  });

  it("rejects ref with backticks", async () => {
    await expect(
      handler({ ref: "`id`", staged: false })
    ).rejects.toThrow(/disallowed characters/);
  });

  it("rejects ref with semicolons", async () => {
    await expect(
      handler({ ref: "HEAD; rm -rf /", staged: false })
    ).rejects.toThrow(/disallowed characters/);
  });

  it("rejects ref with pipes", async () => {
    await expect(
      handler({ ref: "HEAD | cat /etc/passwd", staged: false })
    ).rejects.toThrow(/disallowed characters/);
  });

  it("allows valid ref formats", async () => {
    // These should not throw (even if the ref doesn't exist, the format is valid)
    const validRefs = ["HEAD", "HEAD~1", "HEAD^2", "main", "origin/main", "v1.0.0"];
    for (const ref of validRefs) {
      // May fail because ref doesn't exist, but should NOT fail ref validation
      try {
        await handler({ ref, staged: false });
      } catch (err) {
        expect(String(err)).not.toMatch(/disallowed characters/);
      }
    }
  });
});
