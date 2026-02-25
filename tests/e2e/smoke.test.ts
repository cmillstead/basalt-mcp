/**
 * End-to-end smoke test.
 *
 * Spawns the real MCP server as a child process, connects via
 * StdioClientTransport, and exercises every tool through the
 * full JSON-RPC protocol.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let tmpDir: string;
let client: Client;
let transport: StdioClientTransport;

function touch(relativePath: string, content = ""): void {
  const full = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-e2e-"));

  // Seed the vault
  touch("notes/hello.md", "# Hello\n\nWorld\n");
  touch("notes/todo.md", "# Todos\n\n- [ ] Buy milk\n- [x] Done item\n- [ ] Write tests\n");
  touch("journal/2024-01-15.md", "Today was a good day.\n");
  touch("data.json", '{"key": "value"}\n');

  // Add a symlink that should be excluded
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-outside-"));
  fs.writeFileSync(path.join(outsideDir, "secret.md"), "- [ ] Secret todo\n");
  fs.symlinkSync(outsideDir, path.join(tmpDir, "linked-dir"));

  // Add a dotdir that should be excluded
  touch(".obsidian/config.json", '{"setting": true}\n');

  const serverPath = path.resolve("dist/index.js");

  transport = new StdioClientTransport({
    command: "node",
    args: [serverPath, tmpDir],
    stderr: "pipe",
  });

  client = new Client({ name: "e2e-test", version: "1.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("e2e smoke test", () => {
  it("lists available tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "getAllFilenames",
      "getOpenTodos",
      "readMultipleFiles",
      "updateFileContent",
    ]);
  });

  it("getAllFilenames returns vault files, excludes dotfiles and symlinks", async () => {
    const result = await client.callTool({ name: "getAllFilenames" });
    const files: string[] = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text
    );

    expect(files).toContain("notes/hello.md");
    expect(files).toContain("notes/todo.md");
    expect(files).toContain("journal/2024-01-15.md");
    expect(files).toContain("data.json");

    // Excluded
    expect(files).not.toContain(".obsidian/config.json");
    expect(files.some((f) => f.includes("linked-dir"))).toBe(false);
  });

  it("readMultipleFiles reads by exact name", async () => {
    const result = await client.callTool({
      name: "readMultipleFiles",
      arguments: { filenames: ["notes/hello.md"] },
    });
    const data: Record<string, string> = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text
    );

    expect(data["notes/hello.md"]).toBe("# Hello\n\nWorld\n");
  });

  it("readMultipleFiles partial match works", async () => {
    const result = await client.callTool({
      name: "readMultipleFiles",
      arguments: { filenames: ["hello"] },
    });
    const data: Record<string, string> = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text
    );

    expect(data["notes/hello.md"]).toBe("# Hello\n\nWorld\n");
  });

  it("readMultipleFiles returns not found for missing files", async () => {
    const result = await client.callTool({
      name: "readMultipleFiles",
      arguments: { filenames: ["nonexistent.md"] },
    });
    const data: Record<string, string> = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text
    );

    expect(data["nonexistent.md"]).toBe("[not found]");
  });

  it("getOpenTodos finds unchecked todos, skips checked", async () => {
    const result = await client.callTool({ name: "getOpenTodos" });
    const todos: Array<{ file: string; line: number; text: string }> =
      JSON.parse(
        (result.content as Array<{ type: string; text: string }>)[0].text
      );

    const texts = todos.map((t) => t.text);
    expect(texts).toContain("Buy milk");
    expect(texts).toContain("Write tests");
    expect(texts).not.toContain("Done item");

    // No todos from symlinked or dotfile dirs
    expect(texts).not.toContain("Secret todo");
  });

  it("updateFileContent creates a new file", async () => {
    const result = await client.callTool({
      name: "updateFileContent",
      arguments: {
        filePath: "notes/new-note.md",
        content: "# Created via MCP\n",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;

    expect(text).toMatch(/Successfully wrote/);
    expect(
      fs.readFileSync(path.join(tmpDir, "notes/new-note.md"), "utf-8")
    ).toBe("# Created via MCP\n");
  });

  it("updateFileContent rejects dotpath writes", async () => {
    const result = await client.callTool({
      name: "updateFileContent",
      arguments: {
        filePath: ".obsidian/plugins/evil/main.js",
        content: "malicious",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;

    expect(text).toMatch(/dot-prefixed/);
  });

  it("updateFileContent rejects disallowed extensions", async () => {
    const result = await client.callTool({
      name: "updateFileContent",
      arguments: {
        filePath: "exploit.sh",
        content: "#!/bin/sh\nrm -rf /",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;

    expect(text).toMatch(/not allowed/);
    expect(fs.existsSync(path.join(tmpDir, "exploit.sh"))).toBe(false);
  });

  it("full round-trip: write then read back", async () => {
    await client.callTool({
      name: "updateFileContent",
      arguments: {
        filePath: "roundtrip.md",
        content: "# Round Trip\n\n- [ ] Verify this works\n",
      },
    });

    // Read it back
    const readResult = await client.callTool({
      name: "readMultipleFiles",
      arguments: { filenames: ["roundtrip.md"] },
    });
    const data: Record<string, string> = JSON.parse(
      (readResult.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(data["roundtrip.md"]).toBe(
      "# Round Trip\n\n- [ ] Verify this works\n"
    );

    // Verify todo scanner picks it up
    const todoResult = await client.callTool({ name: "getOpenTodos" });
    const todos: Array<{ file: string; line: number; text: string }> =
      JSON.parse(
        (todoResult.content as Array<{ type: string; text: string }>)[0].text
      );
    expect(todos.some((t) => t.text === "Verify this works")).toBe(true);
  });
});
