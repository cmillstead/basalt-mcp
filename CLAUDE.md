# CLAUDE.md

## Project Overview

Basalt MCP is a security-hardened MCP server with two independent tool modules: Obsidian vault tools and git tools. The connected AI is treated as the attacker — see SECURITY.md for the full threat model.

## Architecture

- `src/core/` — Shared security framework (validation, vault path, repo path, error sanitization)
- `src/tools/obsidian/` — Obsidian vault tool module (getAllFilenames, readMultipleFiles, getOpenTodos, updateFileContent, searchVault, appendToFile, listFiles)
- `src/tools/git/` — Git tool module (gitStatus, gitLog, gitDiff, gitBlame) — read-only, no mutations
- `src/index.ts` — Server entrypoint, `--vault`/`--repo` flag parsing, conditional tool registration

The vault and repo are independent directories. The vault is a knowledge base (Obsidian markdown), the repo is a code repository (git). Either or both can be provided at startup.

## CLI

```bash
node dist/index.js --vault <path> --repo <path>
```

At least one of `--vault` or `--repo` is required.

## Commands

- `npm run build` — Compile TypeScript
- `npm test` — Run all tests (vitest)
- `npm run test:watch` — Watch mode
- `npm run lint` — Type-check without emitting
- `npm run dev` — Watch mode compilation

## Testing

335 tests across 17 files. All tests use real temp directories and real symlinks — no fs mocking.

- `tests/core/` — Core validation assertions + content boundary tests
- `tests/tools/obsidian/` — Per-tool unit tests (7 files)
- `tests/tools/git/` — Per-tool unit tests (4 files + helpers)
- `tests/security/adversarial.test.ts` — 78 adversarial attack vectors for vault tools
- `tests/security/adversarial-git.test.ts` — 25 adversarial attack vectors for git tools (including git config code execution)
- `tests/security/prompt-injection-defense.test.ts` — 15 indirect prompt injection defense vectors
- `tests/e2e/smoke.test.ts` — Full MCP JSON-RPC protocol test (spawns real server process)

Run a specific test file: `npx vitest run tests/security/adversarial-git.test.ts`

## Security Rules

These are non-negotiable. Do not weaken or bypass them:

- **Every write goes through the 9-step validation chain** in `updateFileContent.ts`. Do not skip steps or reorder them.
- **Extension allowlist, not blocklist.** Only add new extensions after explicit approval. The list: `.md .canvas`
- **Dot-path rejection is per-segment.** Never change to a simple `startsWith(".")` check.
- **Error messages never leak system details.** All errors go through `sanitizeError()`. Never return raw `error.message` to the AI.
- **Symlink defense has 3 layers** (glob, parent walk, O_NOFOLLOW). All three are needed. Do not remove any.
- **All logging uses stderr.** stdout is reserved for MCP JSON-RPC. Never use `console.log`.
- **Vault path is immutable after startup.** Access via `getVaultPath()` only.
- **Repo path is immutable after startup.** Access via `getRepoPath()` only.
- **Git tools use `execFileSync` only.** Never use `exec()` or spawn a shell. Never allow user-controlled subcommands. All commands include `-c` overrides to neutralize malicious `.git/config` options (core.fsmonitor, diff.external, etc.).
- **Git ref names must pass the allowlist pattern.** Never relax `assertSafeRef()`.
- **Git output must strip the repo path.** Never return raw git output without path replacement.
- **Untrusted content is always boundary-wrapped.** Every tool returning user content wraps it with `<<<UNTRUSTED_CONTENT_<token>>>` markers via `wrapUntrustedContent()`. Never remove or weaken boundary markers.
- **Tool descriptions must warn about untrusted content.** Any tool returning user-derived content must include injection warnings in its description string.
- **JSON envelopes include `_meta.contentTrust`.** JSON-returning tools must include metadata distinguishing trusted from untrusted content.

## Conventions

- TypeScript strict mode
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`
- Commit at each meaningful checkpoint
- New security boundaries require adversarial tests in `tests/security/`
