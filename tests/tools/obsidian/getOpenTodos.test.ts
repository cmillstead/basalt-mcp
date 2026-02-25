import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initVault } from "../../../src/core/index.js";
import { handler } from "../../../src/tools/obsidian/getOpenTodos.js";

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

describe("getOpenTodos", () => {
  describe("basic scanning", () => {
    it("finds unchecked todos", async () => {
      touch(
        "tasks.md",
        "# Tasks\n- [ ] Buy milk\n- [ ] Write tests\n"
      );

      const result = await handler();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ file: "tasks.md", line: 2, text: "Buy milk" });
      expect(result[1]).toEqual({ file: "tasks.md", line: 3, text: "Write tests" });
    });

    it("ignores checked todos", async () => {
      touch(
        "tasks.md",
        "- [ ] Open\n- [x] Done\n- [X] Also done\n"
      );

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Open");
    });

    it("scans across multiple files", async () => {
      touch("a.md", "- [ ] Task A\n");
      touch("b.md", "- [ ] Task B\n");

      const result = await handler();

      const texts = result.map((t) => t.text);
      expect(texts).toContain("Task A");
      expect(texts).toContain("Task B");
    });

    it("returns correct line numbers", async () => {
      touch(
        "notes.md",
        "# Header\n\nSome text\n\n- [ ] Deep todo\n"
      );

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(5);
    });

    it("handles indented todos", async () => {
      touch(
        "nested.md",
        "- [ ] Top level\n  - [ ] Indented\n    - [ ] Deep indent\n"
      );

      const result = await handler();

      expect(result).toHaveLength(3);
      expect(result[0].text).toBe("Top level");
      expect(result[1].text).toBe("Indented");
      expect(result[2].text).toBe("Deep indent");
    });
  });

  describe("file filtering", () => {
    it("only scans .md files", async () => {
      touch("notes.md", "- [ ] In markdown\n");
      touch("data.txt", "- [ ] In text file\n");
      touch("config.json", "- [ ] In json\n");

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("In markdown");
    });

    it("returns empty array for empty vault", async () => {
      const result = await handler();
      expect(result).toEqual([]);
    });

    it("returns empty array when no todos exist", async () => {
      touch("notes.md", "# Just a heading\n\nSome regular text.\n");

      const result = await handler();
      expect(result).toEqual([]);
    });
  });

  describe("security", () => {
    it("excludes todos in dotfiles", async () => {
      touch(".hidden.md", "- [ ] Secret todo\n");
      touch("visible.md", "- [ ] Visible todo\n");

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Visible todo");
    });

    it("excludes todos in dotdirs", async () => {
      touch(".obsidian/notes.md", "- [ ] Hidden todo\n");
      touch("notes.md", "- [ ] Normal todo\n");

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Normal todo");
    });

    it("excludes todos reached through symlinked files", async () => {
      touch("real.md", "- [ ] Real todo\n");

      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-"));
      fs.writeFileSync(path.join(outsideDir, "external.md"), "- [ ] External todo\n");
      fs.symlinkSync(
        path.join(outsideDir, "external.md"),
        path.join(tmpDir, "link.md")
      );

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Real todo");

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("excludes todos reached through symlinked directories", async () => {
      touch("real.md", "- [ ] Real todo\n");

      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-"));
      fs.writeFileSync(path.join(outsideDir, "secret.md"), "- [ ] Secret todo\n");
      fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Real todo");

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe("edge cases", () => {
    it("handles files with no trailing newline", async () => {
      touch("no-newline.md", "- [ ] No newline at end");

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("No newline at end");
    });

    it("ignores malformed checkboxes", async () => {
      touch(
        "malformed.md",
        [
          "- [] Missing space in brackets",
          "-[ ] Missing space before bracket",
          "- [ ]Missing space after bracket",
          "* [ ] Asterisk instead of dash",
          "- [ ] Valid todo",
        ].join("\n")
      );

      const result = await handler();

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Valid todo");
    });
  });
});
