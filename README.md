# Basalt MCP

A security-hardened [Model Context Protocol](https://modelcontextprotocol.io/) server for Obsidian vaults. Built on the assumption that the connected AI is the attacker.

## Tools

| Tool | Description |
|------|-------------|
| `getAllFilenames` | List all vault files, sorted by most recently modified |
| `readMultipleFiles` | Read files by exact, case-insensitive, or partial name match |
| `getOpenTodos` | Find all unchecked todo items (`- [ ]`) across markdown files |
| `updateFileContent` | Create or update files (9-step write validation chain) |

## Quick Start

```bash
npm install
npm run build
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/basalt-mcp/dist/index.js", "/path/to/your/vault"]
    }
  }
}
```

### Direct

```bash
node dist/index.js /path/to/your/vault
```

The server communicates over stdio using the MCP JSON-RPC protocol.

## Security

The server treats every tool call as potentially hostile. All filesystem access is sandboxed to the vault directory through multiple independent layers:

- **9-step write validation chain** — null bytes, dot-paths, extension allowlist, path limits, vault containment, symlinked parent walk, atomic `O_NOFOLLOW` write
- **Extension allowlist** — only `.md`, `.txt`, `.csv`, `.json`, `.yaml`, `.yml`, `.canvas`
- **3-layer symlink defense** — glob-level exclusion, parent directory walk, kernel-level `O_NOFOLLOW`
- **Error sanitization** — never leaks system paths or OS details
- **Resource limits** — 10 MB read cap, 1 MB write cap, 50 filenames per request, 5 partial match results

See [SECURITY.md](SECURITY.md) for the full threat model, design rationale, and all 48 tested attack vectors.

## Development

```bash
npm test            # run all 148 tests
npm run test:watch  # watch mode
npm run lint        # type-check without emitting
npm run dev         # watch mode compilation
```

### Project Structure

```
src/
├── index.ts                    Server entrypoint (stdio transport)
├── core/                       Shared security framework
│   ├── validation.ts           Assertion functions (7)
│   ├── vault.ts                Immutable vault path management
│   └── errors.ts               Error sanitization
└── tools/
    └── obsidian/               Obsidian vault tool module
        ├── getAllFilenames.ts
        ├── readMultipleFiles.ts
        ├── getOpenTodos.ts
        └── updateFileContent.ts
```

The architecture separates the security core from tool implementations. The core handles validation, sandboxing, and error sanitization. Tool modules plug into the core and inherit all protections. New tool modules can be added under `src/tools/` without modifying the security layer.

## License

MIT
