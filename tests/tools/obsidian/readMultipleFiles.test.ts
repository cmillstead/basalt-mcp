import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/readMultipleFiles.js";

let tmpDir: string;

function touch(relativePath: string, content = ""): void {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-test-"));
  initVault(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readMultipleFiles", () => {
  describe("exact match", () => {
    it("reads a file by exact path", async () => {
      touch("notes/hello.md", "# Hello World");

      const result = await handler({ filenames: ["notes/hello.md"] });

      expect(result["notes/hello.md"]).toContain("# Hello World");
      expect(result["notes/hello.md"]).toMatch(/<<<UNTRUSTED_CONTENT_[0-9a-f]{32}>>>/);
      expect(result["notes/hello.md"]).toMatch(/<<<END_UNTRUSTED_CONTENT_[0-9a-f]{32}>>>$/);
    });

    it("reads multiple files", async () => {
      touch("a.md", "content a");
      touch("b.md", "content b");

      const result = await handler({ filenames: ["a.md", "b.md"] });

      expect(result["a.md"]).toContain("content a");
      expect(result["b.md"]).toContain("content b");
    });
  });

  describe("case-insensitive match", () => {
    it("finds file with different casing", async () => {
      touch("Notes/README.md", "readme content");

      const result = await handler({ filenames: ["notes/readme.md"] });

      expect(result["Notes/README.md"]).toContain("readme content");
    });
  });

  describe("partial match", () => {
    it("finds files by partial filename", async () => {
      touch("journal/2024-01-01.md", "january");
      touch("journal/2024-02-01.md", "february");

      const result = await handler({ filenames: ["2024-01"] });

      expect(result["journal/2024-01-01.md"]).toContain("january");
    });

    it("caps partial matches at 5 results", async () => {
      for (let i = 0; i < 10; i++) {
        touch(`note-${i}.md`, `content ${i}`);
      }

      const result = await handler({ filenames: ["note-"] });

      const matchedKeys = Object.keys(result).filter(
        (k) => k !== "note-" && result[k] !== "[not found]"
      );
      expect(matchedKeys.length).toBeLessThanOrEqual(5);
    });

    it("matches against basename not full path", async () => {
      touch("deep/nested/target.md", "found it");
      touch("other/path/stuff.md", "not this");

      const result = await handler({ filenames: ["target"] });

      expect(result["deep/nested/target.md"]).toContain("found it");
      expect(result).not.toHaveProperty("other/path/stuff.md");
    });
  });

  describe("not found", () => {
    it("returns [not found] for missing files", async () => {
      const result = await handler({ filenames: ["nonexistent.md"] });

      expect(result["nonexistent.md"]).toBe("[not found]");
    });
  });

  describe("resolution priority", () => {
    it("prefers exact match over case-insensitive", async () => {
      touch("notes/readme.md", "exact");
      touch("notes/READMORE.md", "different");

      const result = await handler({ filenames: ["notes/readme.md"] });

      // Exact match should win — not partial match on "readme"
      expect(result["notes/readme.md"]).toContain("exact");
      expect(result).not.toHaveProperty("notes/READMORE.md");
    });

    it("prefers case-insensitive match over partial", async () => {
      touch("notes/meeting.md", "exact case match");
      touch("notes/meeting-notes.md", "partial match");

      const result = await handler({ filenames: ["notes/meeting.md"] });

      // Should get exact/case match, not partial
      expect(result["notes/meeting.md"]).toContain("exact case match");
      expect(result).not.toHaveProperty("notes/meeting-notes.md");
    });
  });

  describe("content boundaries", () => {
    it("uses different tokens for different files", async () => {
      touch("a.md", "content a");
      touch("b.md", "content b");

      const result = await handler({ filenames: ["a.md", "b.md"] });

      const tokenA = result["a.md"].match(/UNTRUSTED_CONTENT_([0-9a-f]{32})/)?.[1];
      const tokenB = result["b.md"].match(/UNTRUSTED_CONTENT_([0-9a-f]{32})/)?.[1];
      expect(tokenA).toBeDefined();
      expect(tokenB).toBeDefined();
      expect(tokenA).not.toBe(tokenB);
    });

    it("does not wrap [not found] results", async () => {
      const result = await handler({ filenames: ["nonexistent.md"] });
      expect(result["nonexistent.md"]).toBe("[not found]");
      expect(result["nonexistent.md"]).not.toContain("UNTRUSTED_CONTENT");
    });

    it("does not wrap error results", async () => {
      const result = await handler({ filenames: ["hello\0.md"] });
      expect(result["hello\0.md"]).not.toContain("UNTRUSTED_CONTENT");
    });
  });

  describe("security", () => {
    it("rejects null bytes in query", async () => {
      touch("notes/hello.md", "content");

      const result = await handler({ filenames: ["hello\0.md"] });

      expect(result["hello\0.md"]).toMatch(/null bytes/);
    });

    it("excludes symlinked files", async () => {
      touch("real.md", "real content");
      fs.symlinkSync(
        path.join(tmpDir, "real.md"),
        path.join(tmpDir, "link.md")
      );

      const result = await handler({ filenames: ["link.md"] });

      expect(result["link.md"]).toBe("[not found]");
    });

    it("excludes files through symlinked parent directories", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "basalt-outside-")
      );
      fs.writeFileSync(path.join(outsideDir, "secret.md"), "secret");
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler({ filenames: ["secret.md"] });

      // Should not find it — symlinked dir is excluded by getAllFilenames
      expect(result["secret.md"]).toBe("[not found]");

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("does not leak system paths in errors", async () => {
      const result = await handler({ filenames: ["../../../etc/passwd"] });

      const value = Object.values(result)[0];
      expect(value).not.toMatch(/\/etc\/passwd/);
      expect(value).not.toMatch(/Users/);
    });
  });
});
