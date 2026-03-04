import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/listFiles.js";

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

describe("listFiles", () => {
  // ── Basic listing ──────────────────────────────────────────────────

  describe("basic listing", () => {
    it("returns all files when no filters are provided", async () => {
      touch("notes/hello.md", "# Hello");
      touch("journal/2024-01-01.md", "Entry");
      touch("config.json", '{"key":"value"}');
      touch("readme.txt", "Read me");

      const result = await handler({});

      expect(result).toContain("notes/hello.md");
      expect(result).toContain("journal/2024-01-01.md");
      expect(result).toContain("config.json");
      expect(result).toContain("readme.txt");
      expect(result).toHaveLength(4);
    });

    it("returns empty array for empty vault", async () => {
      const result = await handler({});
      expect(result).toEqual([]);
    });
  });

  // ── Folder filtering ───────────────────────────────────────────────

  describe("folder filtering", () => {
    it("filters to specific folder", async () => {
      touch("rules/naming.md", "naming rules");
      touch("rules/format.md", "format rules");
      touch("notes/idea.md", "an idea");

      const result = await handler({ folder: "rules" });

      expect(result).toContain("rules/naming.md");
      expect(result).toContain("rules/format.md");
      expect(result).not.toContain("notes/idea.md");
      expect(result).toHaveLength(2);
    });

    it("includes files in nested subfolders", async () => {
      touch("rules/auth/login.md", "login rules");
      touch("rules/auth/signup.md", "signup rules");
      touch("rules/general.md", "general rules");
      touch("notes/idea.md", "an idea");

      const result = await handler({ folder: "rules" });

      expect(result).toContain("rules/auth/login.md");
      expect(result).toContain("rules/auth/signup.md");
      expect(result).toContain("rules/general.md");
      expect(result).not.toContain("notes/idea.md");
      expect(result).toHaveLength(3);
    });

    it("treats folder '.' as vault root (returns all files)", async () => {
      touch("notes/hello.md", "hello");
      touch("journal/entry.md", "entry");
      touch("top.md", "top");

      const result = await handler({ folder: "." });

      expect(result).toContain("notes/hello.md");
      expect(result).toContain("journal/entry.md");
      expect(result).toContain("top.md");
      expect(result).toHaveLength(3);
    });

    it("returns empty array when folder has no files", async () => {
      touch("notes/idea.md", "an idea");
      fs.mkdirSync(path.join(tmpDir, "empty-folder"), { recursive: true });

      const result = await handler({ folder: "empty-folder" });

      expect(result).toEqual([]);
    });

    it("does not match partial folder names", async () => {
      touch("my-rules/style.md", "style guide");
      touch("rules/naming.md", "naming rules");
      touch("rules-extra/bonus.md", "bonus");

      const result = await handler({ folder: "rules" });

      expect(result).toContain("rules/naming.md");
      expect(result).not.toContain("my-rules/style.md");
      expect(result).not.toContain("rules-extra/bonus.md");
      expect(result).toHaveLength(1);
    });
  });

  // ── Extension filtering ────────────────────────────────────────────

  describe("extension filtering", () => {
    it("filters by .md extension", async () => {
      touch("notes/hello.md", "hello");
      touch("config.json", "{}");
      touch("readme.txt", "read me");

      const result = await handler({ extension: ".md" });

      expect(result).toContain("notes/hello.md");
      expect(result).not.toContain("config.json");
      expect(result).not.toContain("readme.txt");
      expect(result).toHaveLength(1);
    });

    it("rejects disallowed extension (.json)", async () => {
      touch("notes/hello.md", "hello");
      touch("config.json", "{}");

      await expect(handler({ extension: ".json" })).rejects.toThrow("Extension not allowed");
    });

    it("is case-insensitive on extension", async () => {
      touch("UPPER.MD", "upper");
      touch("lower.md", "lower");
      touch("mixed.Md", "mixed");

      const result = await handler({ extension: ".md" });

      expect(result).toContain("UPPER.MD");
      expect(result).toContain("lower.md");
      expect(result).toContain("mixed.Md");
      expect(result).toHaveLength(3);
    });

    it("returns empty array when no files match allowed extension", async () => {
      touch("notes/hello.md", "hello");

      const result = await handler({ extension: ".canvas" });

      expect(result).toEqual([]);
    });

    it("rejects disallowed extension (.csv)", async () => {
      await expect(handler({ extension: ".csv" })).rejects.toThrow("Extension not allowed");
    });
  });

  // ── Combined filters ──────────────────────────────────────────────

  describe("combined filters", () => {
    it("filters by folder AND extension together", async () => {
      touch("rules/naming.md", "naming");
      touch("rules/config.json", "{}");
      touch("notes/idea.md", "idea");
      touch("notes/data.json", "[]");

      const result = await handler({ folder: "rules", extension: ".md" });

      expect(result).toContain("rules/naming.md");
      expect(result).not.toContain("rules/config.json");
      expect(result).not.toContain("notes/idea.md");
      expect(result).not.toContain("notes/data.json");
      expect(result).toHaveLength(1);
    });
  });

  // ── Security ──────────────────────────────────────────────────────

  describe("security", () => {
    it("rejects null bytes in folder", async () => {
      await expect(handler({ folder: "rules\0evil" })).rejects.toThrow(
        /null bytes/
      );
    });

    it("rejects dot-paths in folder", async () => {
      await expect(handler({ folder: ".hidden" })).rejects.toThrow(
        /dot-prefixed/
      );
    });

    it("rejects folder traversal via ../", async () => {
      await expect(handler({ folder: "../outside" })).rejects.toThrow(
        /dot-prefixed/
      );
    });

    it("rejects null bytes in extension", async () => {
      await expect(handler({ extension: ".md\0" })).rejects.toThrow(
        /null bytes/
      );
    });

    it("rejects extension without leading dot", async () => {
      await expect(handler({ extension: "md" })).rejects.toThrow(
        /must start with a dot/
      );
    });

    it("excludes dotfiles from results", async () => {
      touch("visible.md", "visible");
      touch(".hidden.md", "hidden");

      const result = await handler({});

      expect(result).toContain("visible.md");
      expect(result).not.toContain(".hidden.md");
    });

    it("excludes symlinked files from results", async () => {
      touch("real.md", "real content");

      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "basalt-outside-")
      );
      fs.writeFileSync(path.join(outsideDir, "secret.md"), "content");
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler({});

      expect(result).toContain("real.md");
      expect(result).not.toContain("linked-dir/secret.md");

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  // ── Sort order ────────────────────────────────────────────────────

  describe("sort order", () => {
    it("preserves mtime sort order from getAllFilenames", async () => {
      touch("old.md", "old");
      const oldPath = path.join(tmpDir, "old.md");
      fs.utimesSync(oldPath, new Date("2020-01-01"), new Date("2020-01-01"));

      touch("mid.md", "mid");
      const midPath = path.join(tmpDir, "mid.md");
      fs.utimesSync(midPath, new Date("2023-01-01"), new Date("2023-01-01"));

      touch("new.md", "new");
      const newPath = path.join(tmpDir, "new.md");
      fs.utimesSync(newPath, new Date("2025-01-01"), new Date("2025-01-01"));

      const result = await handler({});

      expect(result.indexOf("new.md")).toBeLessThan(result.indexOf("mid.md"));
      expect(result.indexOf("mid.md")).toBeLessThan(result.indexOf("old.md"));
    });
  });
});
