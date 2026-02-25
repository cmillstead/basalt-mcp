# CLAUDE.md

## Project Overview

Basalt MCP is a security-hardened MCP server for Obsidian vaults. The connected AI is treated as the attacker — see SECURITY.md for the full threat model.

## Architecture

- `src/core/` — Shared security framework (validation, vault path, error sanitization)
- `src/tools/obsidian/` — Obsidian vault tool module (getAllFilenames, readMultipleFiles, getOpenTodos, updateFileContent)
- `src/index.ts` — Server entrypoint, tool registration, stdio transport

The core and tools are intentionally separated. New tool modules go under `src/tools/` and inherit the core security layer.

## Commands

- `npm run build` — Compile TypeScript
- `npm test` — Run all tests (vitest)
- `npm run test:watch` — Watch mode
- `npm run lint` — Type-check without emitting
- `npm run dev` — Watch mode compilation

## Testing

148 tests across 7 files. All tests use real temp directories and real symlinks — no fs mocking.

- `tests/core/` — Core validation assertions
- `tests/tools/obsidian/` — Per-tool unit tests
- `tests/security/adversarial.test.ts` — 48 adversarial attack vectors across 10 attack surfaces
- `tests/e2e/smoke.test.ts` — Full MCP JSON-RPC protocol test (spawns real server process)

Run a specific test file: `npx vitest run tests/security/adversarial.test.ts`

## Security Rules

These are non-negotiable. Do not weaken or bypass them:

- **Every write goes through the 9-step validation chain** in `updateFileContent.ts`. Do not skip steps or reorder them.
- **Extension allowlist, not blocklist.** Only add new extensions after explicit approval. The list: `.md .txt .csv .json .yaml .yml .canvas`
- **Dot-path rejection is per-segment.** Never change to a simple `startsWith(".")` check.
- **Error messages never leak system details.** All errors go through `sanitizeError()`. Never return raw `error.message` to the AI.
- **Symlink defense has 3 layers** (glob, parent walk, O_NOFOLLOW). All three are needed. Do not remove any.
- **All logging uses stderr.** stdout is reserved for MCP JSON-RPC. Never use `console.log`.
- **Vault path is immutable after startup.** Access via `getVaultPath()` only.

## Conventions

- TypeScript strict mode
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`
- Commit at each meaningful checkpoint
- New security boundaries require adversarial tests in `tests/security/`
