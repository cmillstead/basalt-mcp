import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handler } from "../../../src/tools/git/gitBlame.js";
import { setupGitRepo, teardownGitRepo } from "./helpers.js";

beforeEach(() => setupGitRepo());
afterEach(() => teardownGitRepo());

describe("gitBlame", () => {
  it("shows blame for a file", async () => {
    const result = await handler({ filePath: "file1.ts" });
    expect(result).toContain("const x = 1");
    expect(result).toContain("const z = 3");
    expect(result).toMatch(/<<<UNTRUSTED_CONTENT_[0-9a-f]{32}>>>/);
  });

  it("includes author info", async () => {
    const result = await handler({ filePath: "file1.ts" });
    expect(result).toContain("Test User");
  });

  it("rejects path traversal", async () => {
    await expect(
      handler({ filePath: "../../../etc/passwd" })
    ).rejects.toThrow(/outside the vault|dot-prefixed/);
  });

  it("rejects null bytes", async () => {
    await expect(
      handler({ filePath: "file1\0.ts" })
    ).rejects.toThrow(/null bytes/);
  });

  it("does not leak repo path in output", async () => {
    const result = await handler({ filePath: "file1.ts" });
    expect(result).not.toMatch(/\/private\/var|\/tmp\/basalt/);
  });

  it("handles nonexistent file gracefully", async () => {
    await expect(
      handler({ filePath: "nonexistent.ts" })
    ).rejects.toThrow();
  });
});
