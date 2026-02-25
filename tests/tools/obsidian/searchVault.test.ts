import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/searchVault.js";

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

describe("searchVault", () => {
  describe("basic search", () => {
    it("finds text in a single file", async () => {
      touch("notes.md", "Hello world\nGoodbye world\n");

      const result = await handler({ query: "Hello" });

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("notes.md");
      expect(result[0].context).toContain("Hello world");
    });

    it("finds text across multiple files", async () => {
      touch("a.md", "findme alpha\n");
      touch("b.md", "findme beta\n");

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(2);
      const files = result.map((m) => m.file);
      expect(files).toContain("a.md");
      expect(files).toContain("b.md");
    });

    it("returns correct 1-based line numbers", async () => {
      touch(
        "lines.md",
        "line one\nline two\nline three\ntarget here\nline five\n"
      );

      const result = await handler({ query: "target here" });

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(4);
    });

    it("returns context lines around matches (default 2)", async () => {
      touch(
        "ctx.md",
        "line1\nline2\nline3\nmatch here\nline5\nline6\nline7\n"
      );

      const result = await handler({ query: "match here" });

      expect(result).toHaveLength(1);
      expect(result[0].context).toContain("line2");
      expect(result[0].context).toContain("line3");
      expect(result[0].context).toContain("match here");
      expect(result[0].context).toContain("line5");
      expect(result[0].context).toContain("line6");
    });

    it("returns 0 context lines when contextLines is 0", async () => {
      touch(
        "ctx.md",
        "before\nmatch here\nafter\n"
      );

      const result = await handler({ query: "match here", contextLines: 0 });

      expect(result).toHaveLength(1);
      expect(result[0].context).toContain("match here");
      expect(result[0].context).not.toContain("before");
      expect(result[0].context).not.toContain("after");
    });

    it("caps results at 20 matches", async () => {
      const lines = Array.from({ length: 30 }, (_, i) => `findme line ${i}`).join("\n");
      touch("many.md", lines);

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(20);
    });

    it("returns empty array when no matches", async () => {
      touch("notes.md", "nothing interesting here\n");

      const result = await handler({ query: "nonexistent" });

      expect(result).toEqual([]);
    });

    it("is case-insensitive", async () => {
      touch("case.md", "Hello World\n");

      const result = await handler({ query: "hello world" });

      expect(result).toHaveLength(1);
      expect(result[0].context).toContain("Hello World");
    });
  });

  describe("regex search", () => {
    it("finds regex patterns with useRegex: true", async () => {
      touch("regex.md", "foo123bar\nfoo456bar\nbaz\n");

      const result = await handler({ query: "foo\\d+bar", useRegex: true });

      expect(result).toHaveLength(2);
      expect(result[0].context).toContain("foo123bar");
      expect(result[1].context).toContain("foo456bar");
    });

    it("returns ValidationError for invalid regex", async () => {
      touch("notes.md", "some content\n");

      await expect(
        handler({ query: "[invalid(", useRegex: true })
      ).rejects.toThrow(/regular expression/);
    });

    it("escapes special characters in plain text mode", async () => {
      touch("special.md", "file.md is here\nfileXmd is here\n");

      const result = await handler({ query: "file.md" });

      expect(result).toHaveLength(1);
      expect(result[0].context).toContain("file.md is here");
    });
  });

  describe("folder filtering", () => {
    it("limits search to a specific folder", async () => {
      touch("notes/a.md", "findme in notes\n");
      touch("journal/b.md", "findme in journal\n");

      const result = await handler({ query: "findme", folder: "notes" });

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("notes/a.md");
    });

    it("treats folder '.' as vault root (searches all files)", async () => {
      touch("notes/a.md", "findme in notes\n");
      touch("journal/b.md", "findme in journal\n");

      const result = await handler({ query: "findme", folder: "." });

      expect(result).toHaveLength(2);
    });

    it("does not match files outside the folder", async () => {
      touch("notes/inside.md", "findme\n");
      touch("outside.md", "findme\n");
      touch("other/also-outside.md", "findme\n");

      const result = await handler({ query: "findme", folder: "notes" });

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("notes/inside.md");
    });
  });

  describe("context lines", () => {
    it("handles match at start of file (fewer lines before)", async () => {
      touch("start.md", "match here\nline2\nline3\nline4\nline5\n");

      const result = await handler({ query: "match here" });

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(1);
      expect(result[0].context).toContain("match here");
      expect(result[0].context).toContain("line2");
      expect(result[0].context).toContain("line3");
    });

    it("handles match at end of file (fewer lines after)", async () => {
      touch("end.md", "line1\nline2\nline3\nmatch here");

      const result = await handler({ query: "match here" });

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(4);
      expect(result[0].context).toContain("line2");
      expect(result[0].context).toContain("line3");
      expect(result[0].context).toContain("match here");
    });
  });

  describe("content boundaries", () => {
    it("wraps context in UNTRUSTED_CONTENT boundary markers", async () => {
      touch("boundary.md", "findme here\n");

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(1);
      expect(result[0].context).toMatch(/<<<UNTRUSTED_CONTENT_[0-9a-f]{32}>>>/);
      expect(result[0].context).toMatch(/<<<END_UNTRUSTED_CONTENT_[0-9a-f]{32}>>>/);
    });

    it("uses different tokens for different matches", async () => {
      touch("multi.md", "findme first\nother\nfindme second\n");

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(2);

      const tokenPattern = /<<<UNTRUSTED_CONTENT_([0-9a-f]{32})>>>/;
      const token1 = result[0].context.match(tokenPattern)?.[1];
      const token2 = result[1].context.match(tokenPattern)?.[1];

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2);
    });
  });

  describe("security", () => {
    it("rejects null bytes in query", async () => {
      touch("notes.md", "some content\n");

      await expect(
        handler({ query: "find\0me" })
      ).rejects.toThrow(/null bytes/);
    });

    it("rejects null bytes in folder", async () => {
      touch("notes/a.md", "content\n");

      await expect(
        handler({ query: "content", folder: "notes\0evil" })
      ).rejects.toThrow(/null bytes/);
    });

    it("rejects dot-paths in folder", async () => {
      touch("notes/a.md", "content\n");

      await expect(
        handler({ query: "content", folder: ".hidden" })
      ).rejects.toThrow(/dot-prefixed/);
    });

    it("excludes dotfiles from search", async () => {
      touch(".hidden.md", "findme in hidden\n");
      touch("visible.md", "findme in visible\n");

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("visible.md");
    });

    it("skips non-text files (binary attachments)", async () => {
      touch("notes.md", "findme in markdown\n");
      touch("image.png", "findme in binary\n");
      touch("data.json", "findme in json\n");
      touch("readme.txt", "findme in txt\n");
      touch("board.canvas", '{"findme": "in canvas"}\n');

      const result = await handler({ query: "findme" });

      const files = result.map((m) => m.file);
      expect(files).toContain("notes.md");
      expect(files).toContain("board.canvas");
      expect(files).not.toContain("image.png");
      expect(files).not.toContain("data.json");
      expect(files).not.toContain("readme.txt");
    });

    it("excludes symlinked files from search", async () => {
      touch("real.md", "findme in real\n");

      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-"));
      fs.writeFileSync(path.join(outsideDir, "secret.md"), "findme in secret\n");
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler({ query: "findme" });

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("real.md");

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });
});
