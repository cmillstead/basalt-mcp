import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/getAllFilenames.js";

let tmpDir: string;

function touch(relativePath: string, content = ""): void {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function touchWithMtime(relativePath: string, mtime: Date): void {
  touch(relativePath);
  const full = path.join(tmpDir, relativePath);
  fs.utimesSync(full, mtime, mtime);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-test-"));
  initVault(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getAllFilenames", () => {
  it("returns files from the vault", async () => {
    touch("notes/hello.md", "# Hello");
    touch("journal/2024-01-01.md", "Entry");

    const result = await handler();

    expect(result).toContain("notes/hello.md");
    expect(result).toContain("journal/2024-01-01.md");
  });

  it("sorts by most recently modified first", async () => {
    touchWithMtime("old.md", new Date("2020-01-01"));
    touchWithMtime("mid.md", new Date("2023-01-01"));
    touchWithMtime("new.md", new Date("2025-01-01"));

    const result = await handler();

    expect(result.indexOf("new.md")).toBeLessThan(result.indexOf("mid.md"));
    expect(result.indexOf("mid.md")).toBeLessThan(result.indexOf("old.md"));
  });

  it("excludes dotfiles", async () => {
    touch("notes/visible.md");
    touch(".hidden-file.md");

    const result = await handler();

    expect(result).toContain("notes/visible.md");
    expect(result).not.toContain(".hidden-file.md");
  });

  it("excludes files inside dotdirs", async () => {
    touch("notes/visible.md");
    touch(".obsidian/plugins.json");
    touch(".git/config");

    const result = await handler();

    expect(result).toContain("notes/visible.md");
    expect(result).not.toContain(".obsidian/plugins.json");
    expect(result).not.toContain(".git/config");
  });

  it("excludes symlinked files", async () => {
    touch("real.md", "real content");
    const linkPath = path.join(tmpDir, "link.md");
    fs.symlinkSync(path.join(tmpDir, "real.md"), linkPath);

    const result = await handler();

    expect(result).toContain("real.md");
    expect(result).not.toContain("link.md");
  });

  it("excludes files reached through symlinked directories", async () => {
    // Create a directory outside the vault
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-"));
    fs.writeFileSync(path.join(outsideDir, "secret.md"), "secret");

    // Symlink it into the vault
    fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

    const result = await handler();

    expect(result).not.toContain("linked-dir/secret.md");

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("returns empty array for empty vault", async () => {
    const result = await handler();
    expect(result).toEqual([]);
  });

  it("handles nested directory structures", async () => {
    touch("a/b/c/deep.md");
    touch("top.md");

    const result = await handler();

    expect(result).toContain("a/b/c/deep.md");
    expect(result).toContain("top.md");
  });
});
