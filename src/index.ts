#!/usr/bin/env node

/**
 * Basalt MCP Server
 *
 * Secure MCP server with modular tool support.
 * Obsidian vault tools are the first module.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initVault } from "./core/index.js";
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

const vaultArg = process.argv[2];
if (!vaultArg) {
  console.error("Usage: basalt-mcp <vault-path>");
  process.exit(1);
}

try {
  const vaultPath = initVault(vaultArg);
  console.error(`[basalt-mcp] Vault: ${vaultPath}`);
} catch (err) {
  console.error(`[basalt-mcp] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const server = new McpServer({
  name: "basalt-mcp",
  version: "0.1.0",
});

// Register Obsidian vault tools
// Parameterless tools use the (name, description, callback) overload
server.tool("getAllFilenames", getAllFilenamesDescription, async () => ({
  content: [{ type: "text", text: JSON.stringify(await getAllFilenames(), null, 2) }],
}));

server.tool("readMultipleFiles", readMultipleFilesDescription, readMultipleFilesSchema.shape, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await readMultipleFiles(args), null, 2) }],
}));

server.tool("getOpenTodos", getOpenTodosDescription, async () => ({
  content: [{ type: "text", text: JSON.stringify(await getOpenTodos(), null, 2) }],
}));

server.tool("updateFileContent", updateFileContentDescription, updateFileContentSchema.shape, async (args) => ({
  content: [{ type: "text", text: await updateFileContent(args) }],
}));

// Connect via stdio — all logging must use stderr from this point
const transport = new StdioServerTransport();
await server.connect(transport);
