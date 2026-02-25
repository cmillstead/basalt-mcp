import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handler } from "../../../src/tools/git/gitLog.js";
import { setupGitRepo, teardownGitRepo, touch, gitCmd } from "./helpers.js";

beforeEach(() => setupGitRepo());
afterEach(() => teardownGitRepo());

describe("gitLog", () => {
  it("returns commit history", async () => {
    const result = await handler({ maxCount: 20 });
    expect(result).toContain("initial commit");
    expect(result).toContain("add z variable");
    expect(result).toMatch(/<<<UNTRUSTED_CONTENT_[0-9a-f]{32}>>>/);
  });

  it("respects maxCount", async () => {
    const result = await handler({ maxCount: 1 });
    expect(result).toContain("add z variable");
    expect(result).not.toContain("initial commit");
  });

  it("includes commit hashes", async () => {
    const result = await handler({ maxCount: 20 });
    // SHA-1 hashes are 40 hex chars
    expect(result).toMatch(/[0-9a-f]{40}/);
  });

  it("includes author email", async () => {
    const result = await handler({ maxCount: 20 });
    expect(result).toContain("test@test.com");
  });

  it("does not leak repo path", async () => {
    const result = await handler({ maxCount: 20 });
    expect(result).not.toMatch(/\/private\/var|\/tmp\/basalt/);
  });
});
