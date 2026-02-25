import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/appendToFile.js";

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

describe("appendToFile", () => {
  describe("basic append", () => {
    it("appends content to an existing file", async () => {
      touch("notes.md", "Hello");
      await handler({ filePath: "notes.md", content: " World" });
      const result = fs.readFileSync(path.join(tmpDir, "notes.md"), "utf-8");
      expect(result).toBe("Hello\n World");
    });

    it("adds newline separator when file doesn't end with newline", async () => {
      touch("notes.md", "line one");
      await handler({ filePath: "notes.md", content: "line two" });
      const result = fs.readFileSync(path.join(tmpDir, "notes.md"), "utf-8");
      expect(result).toBe("line one\nline two");
    });

    it("no extra newline when file already ends with newline", async () => {
      touch("notes.md", "line one\n");
      await handler({ filePath: "notes.md", content: "line two" });
      const result = fs.readFileSync(path.join(tmpDir, "notes.md"), "utf-8");
      expect(result).toBe("line one\nline two");
    });

    it("appends to empty file", async () => {
      touch("empty.md", "");
      await handler({ filePath: "empty.md", content: "first content" });
      const result = fs.readFileSync(path.join(tmpDir, "empty.md"), "utf-8");
      expect(result).toBe("first content");
    });

    it("returns success message containing 'Successfully appended'", async () => {
      touch("notes.md", "existing");
      const result = await handler({ filePath: "notes.md", content: "more" });
      expect(result).toMatch(/Successfully appended/);
    });
  });

  describe("file must exist", () => {
    it("returns error for nonexistent file containing 'does not exist'", async () => {
      const result = await handler({
        filePath: "nonexistent.md",
        content: "stuff",
      });
      expect(result).toMatch(/does not exist/);
    });

    it("error message suggests 'updateFileContent'", async () => {
      const result = await handler({
        filePath: "nonexistent.md",
        content: "stuff",
      });
      expect(result).toMatch(/updateFileContent/);
    });

    it("does not create the file", async () => {
      await handler({ filePath: "nonexistent.md", content: "stuff" });
      expect(fs.existsSync(path.join(tmpDir, "nonexistent.md"))).toBe(false);
    });
  });

  describe("path traversal prevention", () => {
    it("rejects ../escape.md", async () => {
      const result = await handler({
        filePath: "../escape.md",
        content: "evil",
      });
      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects nested traversal notes/../../escape.md", async () => {
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
    it("rejects .obsidian/config.json", async () => {
      const result = await handler({
        filePath: ".obsidian/config.json",
        content: "payload",
      });
      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects .git/hooks/pre-commit", async () => {
      const result = await handler({
        filePath: ".git/hooks/pre-commit",
        content: "#!/bin/sh\nmalicious",
      });
      expect(result).toMatch(/dot-prefixed/);
    });

    it("rejects nested dotdirs notes/.secret/file.md", async () => {
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
        touch(`file${ext}`, "existing content");
        const result = await handler({
          filePath: `file${ext}`,
          content: "appended",
        });
        expect(result).toMatch(/Successfully appended/);
      }
    );

    it.each([".js", ".sh", ".py", ".exe", ".html", ".txt", ".csv", ".json", ".yaml", ".yml"])(
      "rejects %s",
      async (ext) => {
        const result = await handler({
          filePath: `file${ext}`,
          content: "payload",
        });
        expect(result).toMatch(/not allowed/);
      }
    );
  });

  describe("path limits", () => {
    it("rejects paths over 512 characters", async () => {
      const long = "a/".repeat(200) + "file.md";
      const result = await handler({ filePath: long, content: "payload" });
      expect(result).toMatch(/maximum length|maximum depth/);
    });

    it("rejects paths deeper than 10 levels", async () => {
      const deep = "a/".repeat(11) + "file.md";
      const result = await handler({ filePath: deep, content: "payload" });
      expect(result).toMatch(/maximum depth/);
    });
  });

  describe("symlink rejection", () => {
    it("rejects appending to a symlinked file", async () => {
      const outsideFile = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-")),
        "target.md"
      );
      fs.writeFileSync(outsideFile, "original");
      fs.symlinkSync(outsideFile, path.join(tmpDir, "link.md"));

      const result = await handler({
        filePath: "link.md",
        content: "appended",
      });
      expect(result).toMatch(/symbolic link/);
      expect(fs.readFileSync(outsideFile, "utf-8")).toBe("original");

      fs.rmSync(path.dirname(outsideFile), { recursive: true, force: true });
    });

    it("rejects appending through a symlinked parent directory", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "basalt-outside-")
      );
      fs.writeFileSync(path.join(outsideDir, "target.md"), "original");
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler({
        filePath: "linked-dir/target.md",
        content: "appended",
      });
      expect(result).toMatch(/symbolic link/);
      expect(fs.readFileSync(path.join(outsideDir, "target.md"), "utf-8")).toBe(
        "original"
      );

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe("size limits", () => {
    it("rejects append that would exceed 10MB", async () => {
      const nearLimit = 10 * 1024 * 1024 - 100;
      touch("big.md", "x".repeat(nearLimit));

      const result = await handler({
        filePath: "big.md",
        content: "y".repeat(200),
      });
      expect(result).toMatch(/maximum file size/);
    });
  });

  describe("vault containment", () => {
    it("rejects absolute paths outside vault", async () => {
      const result = await handler({
        filePath: "/etc/passwd",
        content: "evil",
      });
      expect(result).not.toMatch(/Successfully appended/);
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
