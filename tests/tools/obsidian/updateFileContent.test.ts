import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/updateFileContent.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-test-"));
  initVault(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("updateFileContent", () => {
  describe("file creation and update", () => {
    it("creates a new file", async () => {
      const result = await handler({
        filePath: "notes/new.md",
        content: "# New File",
      });

      expect(result).toMatch(/Successfully wrote/);
      expect(fs.readFileSync(path.join(tmpDir, "notes/new.md"), "utf-8")).toBe(
        "# New File"
      );
    });

    it("overwrites an existing file", async () => {
      const full = path.join(tmpDir, "existing.md");
      fs.writeFileSync(full, "old content");

      const result = await handler({
        filePath: "existing.md",
        content: "new content",
      });

      expect(result).toMatch(/Successfully wrote/);
      expect(fs.readFileSync(full, "utf-8")).toBe("new content");
    });

    it("creates nested parent directories", async () => {
      const result = await handler({
        filePath: "a/b/c/deep.md",
        content: "deep",
      });

      expect(result).toMatch(/Successfully wrote/);
      expect(
        fs.readFileSync(path.join(tmpDir, "a/b/c/deep.md"), "utf-8")
      ).toBe("deep");
    });

    it("writes empty content", async () => {
      const result = await handler({
        filePath: "empty.md",
        content: "",
      });

      expect(result).toMatch(/Successfully wrote/);
      expect(fs.readFileSync(path.join(tmpDir, "empty.md"), "utf-8")).toBe("");
    });
  });

  describe("path traversal prevention", () => {
    it("rejects ../", async () => {
      const result = await handler({
        filePath: "../escape.md",
        content: "evil",
      });

      expect(result).toMatch(/dot-prefixed/);
      expect(fs.existsSync(path.join(tmpDir, "../escape.md"))).toBe(false);
    });

    it("rejects nested traversal", async () => {
      const result = await handler({
        filePath: "notes/../../escape.md",
        content: "evil",
      });

      expect(result).toMatch(/dot-prefixed/);
    });
  });

  describe("null byte rejection", () => {
    it("rejects null bytes in path", async () => {
      const result = await handler({
        filePath: "notes/evil\0.md",
        content: "payload",
      });

      expect(result).toMatch(/null bytes/);
    });
  });

  describe("dot-path rejection", () => {
    it("rejects dotfiles at root", async () => {
      const result = await handler({
        filePath: ".evil.md",
        content: "payload",
      });

      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects .obsidian directory", async () => {
      const result = await handler({
        filePath: ".obsidian/plugins/evil/main.js",
        content: "payload",
      });

      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects .git directory", async () => {
      const result = await handler({
        filePath: ".git/hooks/pre-commit",
        content: "#!/bin/sh\nmalicious",
      });

      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects nested dotdirs", async () => {
      const result = await handler({
        filePath: "notes/.secret/file.md",
        content: "hidden",
      });

      expect(result).toMatch(/dot-prefixed/);
    });
  });

  describe("extension allowlist", () => {
    it.each([".md", ".canvas"])(
      "allows %s",
      async (ext) => {
        const result = await handler({
          filePath: `file${ext}`,
          content: "ok",
        });

        expect(result).toMatch(/Successfully wrote/);
      }
    );

    it.each([".js", ".sh", ".py", ".exe", ".html", ".ts", ".bash", ".txt", ".csv", ".json", ".yaml", ".yml"])(
      "rejects %s",
      async (ext) => {
        const result = await handler({
          filePath: `file${ext}`,
          content: "payload",
        });

        expect(result).toMatch(/not allowed/);
        expect(fs.existsSync(path.join(tmpDir, `file${ext}`))).toBe(false);
      }
    );

    it("rejects files with no extension", async () => {
      const result = await handler({
        filePath: "Makefile",
        content: "payload",
      });

      expect(result).toMatch(/not allowed/);
    });
  });

  describe("path limits", () => {
    it("rejects paths over 512 characters", async () => {
      const long = "a/".repeat(200) + "file.md";
      const result = await handler({ filePath: long, content: "payload" });

      expect(result).toMatch(/maximum length|maximum depth/);
    });

    it("rejects paths deeper than 10 levels", async () => {
      const deep = Array(11).fill("dir").join("/") + "/file.md";
      const result = await handler({ filePath: deep, content: "payload" });

      expect(result).toMatch(/maximum depth/);
    });
  });

  describe("symlink rejection", () => {
    it("rejects writing to a symlinked file", async () => {
      // Create a target file outside the vault
      const outsideFile = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-")),
        "target.md"
      );
      fs.writeFileSync(outsideFile, "original");

      // Symlink it into the vault
      fs.symlinkSync(outsideFile, path.join(tmpDir, "link.md"));

      const result = await handler({
        filePath: "link.md",
        content: "overwrite attempt",
      });

      expect(result).toMatch(/symbolic link/);
      // Original file must be untouched
      expect(fs.readFileSync(outsideFile, "utf-8")).toBe("original");

      fs.rmSync(path.dirname(outsideFile), { recursive: true, force: true });
    });

    it("rejects writing through a symlinked parent directory", async () => {
      // Create a directory outside the vault
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "basalt-outside-")
      );

      // Symlink it into the vault
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler({
        filePath: "linked-dir/evil.md",
        content: "escaped",
      });

      expect(result).toMatch(/symbolic link/);
      expect(fs.existsSync(path.join(outsideDir, "evil.md"))).toBe(false);

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe("vault containment", () => {
    it("rejects absolute paths outside vault", async () => {
      const result = await handler({
        filePath: "/etc/passwd",
        content: "evil",
      });

      // Will fail on dot-path, extension, or containment — any is fine
      expect(result).not.toMatch(/Successfully wrote/);
      expect(fs.readFileSync("/etc/passwd", "utf-8")).not.toBe("evil");
    });
  });

  describe("error sanitization", () => {
    it("does not leak system paths in errors", async () => {
      const result = await handler({
        filePath: "../../../etc/shadow",
        content: "evil",
      });

      expect(result).not.toMatch(/\/etc\/shadow/);
      expect(result).not.toMatch(/Users/);
      expect(result).not.toMatch(tmpDir);
    });
  });
});
