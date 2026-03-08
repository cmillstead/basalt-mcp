# Basalt MCP

A security-hardened [Model Context Protocol](https://modelcontextprotocol.io/) server with two independent tool modules: **Obsidian vault tools** for managing a knowledge base, and **git tools** for LLM-assisted code review. Built for adversarial environments where the connected AI cannot be trusted.

## Tools

### Obsidian Vault Tools (`--vault`)

| Tool | Description |
|------|-------------|
| `getAllFilenames` | List all vault files, sorted by most recently modified |
| `readMultipleFiles` | Read files by exact, case-insensitive, or partial name match |
| `getOpenTodos` | Find all unchecked todo items (`- [ ]`) across markdown files |
| `updateFileContent` | Create or update files (9-step write validation chain) |
| `searchVault` | Search vault files by content (plain text or regex) with context snippets |
| `appendToFile` | Append content to an existing file (no file creation) |
| `listFiles` | List vault files filtered by folder and/or extension |

### Git Tools (`--repo`)

| Tool | Description |
|------|-------------|
| `gitStatus` | Working tree status (staged, unstaged, untracked) |
| `gitLog` | Commit history with configurable depth |
| `gitDiff` | Diff output (working tree, staged, or against a ref) |
| `gitBlame` | Per-line blame for a file |

All git tools are read-only. No mutations (no commit, push, reset, checkout).

## Quick Start

```bash
npm install
npm run build
```

### Usage

```bash
# Both modules — vault for context, repo for code review
node dist/index.js --vault /path/to/vault --repo /path/to/repo

# Vault only
node dist/index.js --vault /path/to/vault

# Repo only
node dist/index.js --repo /path/to/repo
```

At least one of `--vault` or `--repo` is required. The vault and repo are independent directories — the vault is a knowledge base (Obsidian), the repo is a code repository (git).

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "basalt": {
      "command": "node",
      "args": [
        "/absolute/path/to/basalt-mcp/dist/index.js",
        "--vault", "/path/to/your/vault",
        "--repo", "/path/to/your/repo"
      ]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "basalt": {
      "command": "node",
      "args": [
        "/absolute/path/to/basalt-mcp/dist/index.js",
        "--vault", "/path/to/your/vault",
        "--repo", "/path/to/your/repo"
      ]
    }
  }
}
```

The server communicates over stdio using the MCP JSON-RPC protocol.

## Security

The server treats every tool call as potentially hostile.

**Vault tools** — all filesystem access is sandboxed to the vault directory through multiple independent layers:

- **9-step write validation chain** — null bytes, dot-paths, extension allowlist, path limits, vault containment, symlinked parent walk, atomic `O_NOFOLLOW` write
- **Extension allowlist** — only `.md` and `.canvas` (native Obsidian formats)
- **3-layer symlink defense** — glob-level exclusion, parent directory walk, kernel-level `O_NOFOLLOW`
- **Error sanitization** — never leaks system paths or OS details
- **Untrusted-content metadata** — filenames, file content, todos, search results, and git output are marked untrusted for MCP clients
- **Resource limits** — 10 MB read cap, 1 MB write cap, 50 filenames per request, 5 partial match results, 20 search match cap

**Git tools** — all git execution is sandboxed to the repo directory:

- **`execFileSync` only** — no shell, no command injection possible
- **Ref name allowlist** — rejects shell metacharacters, backticks, `$()`, pipes, semicolons
- **Path validation** — blame file paths go through null byte check, repo containment, and symlink walk
- **Output sanitization** — repo path stripped from all output, 100KB output cap, 10s timeout

See [SECURITY.md](SECURITY.md) for the full threat model, design rationale, and all 118 tested attack vectors.

## Development

```bash
npm test            # run all 341 tests
npm run test:watch  # watch mode
npm run lint        # type-check without emitting
npm run dev         # watch mode compilation
```

### Project Structure

```
src/
├── index.ts                    Server entrypoint (--vault/--repo flags, stdio transport)
├── core/                       Shared security framework
│   ├── validation.ts           Assertion functions (7)
│   ├── vault.ts                Immutable vault path management
│   ├── repo.ts                 Immutable repo path management + git validation
│   ├── contentBoundary.ts      Boundary markers for untrusted content (spotlighting)
│   └── errors.ts               Error sanitization
└── tools/
    ├── obsidian/               Obsidian vault tool module
    │   ├── getAllFilenames.ts
    │   ├── readMultipleFiles.ts
    │   ├── getOpenTodos.ts
    │   ├── updateFileContent.ts
    │   ├── searchVault.ts
    │   ├── appendToFile.ts
    │   └── listFiles.ts
    └── git/                    Git tool module
        ├── exec.ts             Safe git execution helper
        ├── gitStatus.ts
        ├── gitLog.ts
        ├── gitDiff.ts
        └── gitBlame.ts
```

The architecture separates the security core from tool implementations. The core handles validation, sandboxing, and error sanitization. Tool modules plug into the core and inherit all protections. The two modules are independent — you can run either or both.

## License

MIT
