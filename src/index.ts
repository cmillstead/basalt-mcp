#!/usr/bin/env node

/**
 * Basalt MCP Server
 *
 * Secure MCP server with modular tool support.
 * --vault enables Obsidian vault tools, --repo enables git tools.
 * At least one must be provided.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initVault, initRepo } from "./core/index.js";
import {
  getAllFilenamesDescription,
  getAllFilenames,
  readMultipleFilesSchema,
  readMultipleFilesDescription,
  readMultipleFiles,
  getOpenTodosDescription,
  getOpenTodos,
  updateFileContentSchema,
  updateFileContentDescription,
  updateFileContent,
} from "./tools/obsidian/index.js";
import {
  gitStatusDescription,
  gitStatus,
  gitLogSchema,
  gitLogDescription,
  gitLog,
  gitDiffSchema,
  gitDiffDescription,
  gitDiff,
  gitBlameSchema,
  gitBlameDescription,
  gitBlame,
} from "./tools/git/index.js";

// Parse --vault and --repo flags
function parseArgs(argv: string[]): { vault?: string; repo?: string } {
  const result: { vault?: string; repo?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--vault" && argv[i + 1]) {
      result.vault = argv[++i];
    } else if (argv[i] === "--repo" && argv[i + 1]) {
      result.repo = argv[++i];
    }
  }
  return result;
}

const args = parseArgs(process.argv);

if (!args.vault && !args.repo) {
  console.error("Usage: basalt-mcp --vault <vault-path> --repo <repo-path>");
  console.error("  At least one of --vault or --repo is required.");
  process.exit(1);
}

let hasVault = false;
let hasRepo = false;

if (args.vault) {
  try {
    const vaultPath = initVault(args.vault);
    console.error(`[basalt-mcp] Vault: ${vaultPath}`);
    hasVault = true;
  } catch (err) {
    console.error(`[basalt-mcp] Fatal (vault): ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

if (args.repo) {
  try {
    const repoPath = initRepo(args.repo);
    console.error(`[basalt-mcp] Repo: ${repoPath}`);
    hasRepo = true;
  } catch (err) {
    console.error(`[basalt-mcp] Fatal (repo): ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

const server = new McpServer({
  name: "basalt-mcp",
  version: "0.2.0",
});

// Register Obsidian vault tools
if (hasVault) {
  server.tool("getAllFilenames", getAllFilenamesDescription, async () => ({
    content: [{ type: "text", text: JSON.stringify(await getAllFilenames(), null, 2) }],
  }));

  server.tool("readMultipleFiles", readMultipleFilesDescription, readMultipleFilesSchema.shape, async (toolArgs) => ({
    content: [{ type: "text", text: JSON.stringify(await readMultipleFiles(toolArgs), null, 2) }],
  }));

  server.tool("getOpenTodos", getOpenTodosDescription, async () => ({
    content: [{ type: "text", text: JSON.stringify(await getOpenTodos(), null, 2) }],
  }));

  server.tool("updateFileContent", updateFileContentDescription, updateFileContentSchema.shape, async (toolArgs) => ({
    content: [{ type: "text", text: await updateFileContent(toolArgs) }],
  }));
}

// Register git tools
if (hasRepo) {
  server.tool("gitStatus", gitStatusDescription, async () => ({
    content: [{ type: "text", text: await gitStatus() }],
  }));

  server.tool("gitLog", gitLogDescription, gitLogSchema.shape, async (toolArgs) => ({
    content: [{ type: "text", text: await gitLog(toolArgs) }],
  }));

  server.tool("gitDiff", gitDiffDescription, gitDiffSchema.shape, async (toolArgs) => ({
    content: [{ type: "text", text: await gitDiff(toolArgs) }],
  }));

  server.tool("gitBlame", gitBlameDescription, gitBlameSchema.shape, async (toolArgs) => ({
    content: [{ type: "text", text: await gitBlame(toolArgs) }],
  }));
}

// Connect via stdio — all logging must use stderr from this point
const transport = new StdioServerTransport();
await server.connect(transport);
