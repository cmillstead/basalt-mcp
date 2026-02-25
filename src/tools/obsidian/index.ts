/**
 * Obsidian vault tool module.
 *
 * Registers all Obsidian-specific tools with the MCP server.
 */

export { description as getAllFilenamesDescription, handler as getAllFilenames } from "./getAllFilenames.js";
export { schema as readMultipleFilesSchema, description as readMultipleFilesDescription, handler as readMultipleFiles } from "./readMultipleFiles.js";
export { description as getOpenTodosDescription, handler as getOpenTodos } from "./getOpenTodos.js";
export { schema as updateFileContentSchema, description as updateFileContentDescription, handler as updateFileContent } from "./updateFileContent.js";
