# Security

Basalt MCP is designed around a single threat model: **the connected AI is the attacker**. It can call any exposed tool with any arguments that pass schema validation. We assume prompt injection, jailbreaking, or a fully compromised model.

This document describes every security boundary in the server and the reasoning behind it. It is based on 19 findings from 3 rounds of auditing a prior implementation, and 68 adversarial attack vectors tested against the current one (48 vault + 20 git).

## What the Server Prevents

| Threat | How |
|--------|-----|
| Reading or writing outside the vault | Path normalization, vault containment check, symlink rejection |
| Code execution via Obsidian plugins | Dot-path rejection blocks `.obsidian/`, `.git/` |
| Code execution via file extensions | Extension allowlist (not blocklist) |
| Command injection via git | `execFileSync` (no shell), ref name allowlist, hardcoded subcommands |
| Git flag injection | `--` separator before user-supplied paths, path validation |
| Resource exhaustion (memory) | 10 MB file size cap, 1 MB write limit, 50 filename cap, 100KB git output cap |
| Resource exhaustion (disk/inodes) | 512-char path limit, 10-level depth limit |
| Information leakage | Error sanitization, repo/vault path stripping from output |

## Write Validation Chain

Every write passes a 9-step pipeline before touching the filesystem. If any step fails, the write is rejected and the filesystem is untouched.

```
1. assertNoNullBytes(filePath)        Reject \0 (path truncation attacks)
2. assertNoDotPaths(filePath)         Reject any segment starting with "."
                                      Blocks .obsidian/, .git/, .hidden.md
3. assertAllowedExtension(filePath)   Allowlist: .md .txt .csv .json .yaml .yml .canvas
4. assertPathLimits(filePath)         Max 512 chars, max 10 directory levels
5. path.resolve(vault, filePath)      Normalize to absolute path
6. assertInsideVault(fullPath, vault) Must start with vault + path.sep (strict prefix)
7. fs.mkdirSync(recursive)           Create parent directories
8. assertNoSymlinkedParents(fullPath) Walk up to vault root, lstat each directory
9. fs.openSync(O_NOFOLLOW)           Atomic symlink rejection on the final file
   write to fd, close in finally
```

Steps 1–6 are pure validation on the string. Step 7 is the only mutation before the write. Steps 8–9 validate the actual filesystem state immediately before writing.

### Why this order matters

- Null bytes are checked first because they can truncate strings in C-level APIs.
- Dot-paths are checked before extension because `.git/hooks/pre-commit` would pass an extension check but must be rejected by the dot-path check.
- `path.resolve` happens after string validation so that `../` attacks are caught by the dot-path check before normalization could hide them.
- `mkdirSync` happens before the symlink walk because the parent directories must exist to be checked.
- `O_NOFOLLOW` is the final gate — even if every prior check is somehow bypassed, the kernel rejects symlink writes atomically.

## Read Protections

| Layer | What it does |
|-------|-------------|
| `glob("**/*", { dot: false, follow: false })` | Excludes dotfiles, dotdirs, and symlink traversal at the glob level |
| `lstatSync` filter | Rejects symlinks that slip through glob |
| `assertInsideVault` | Defense-in-depth containment check on every file before reading |
| `assertNoSymlinkedParents` | Rejects reads through symlinked parent directories |
| `assertFileSize` (10 MB) | Prevents memory exhaustion from large files |
| Partial match cap (5 results) | Prevents read amplification (single-char query matching entire vault) |
| Filename count cap (50 per request) | Bounds total work per request |
| `assertNoNullBytes` | Rejects null bytes in all filename inputs |

## Extension Allowlist

We use an allowlist, not a blocklist. Blocklists miss things.

**Allowed:** `.md` `.txt` `.csv` `.json` `.yaml` `.yml` `.canvas`

Everything else is rejected — including `.js`, `.sh`, `.py`, `.exe`, `.html`, `.ts`, `.bash`, `.so`, `.dylib`, `.dll`, and files with no extension.

Double extensions are safe: `path.extname("file.md.js")` returns `.js`, which is not in the allowlist.

## Symlink Defense

Symlinks are the hardest attack surface. Three independent layers handle them:

1. **Glob-level**: `follow: false` prevents the glob from traversing symlinked directories.
2. **`assertNoSymlinkedParents`**: Walks every directory from the file up to the vault root, calling `lstatSync` on each. Rejects if any directory is a symlink. This prevents the attack where a legitimate directory is swapped for a symlink between the containment check and the filesystem operation.
3. **`O_NOFOLLOW`**: On writes, the file descriptor is opened with `O_NOFOLLOW`. If the final path component is a symlink, the kernel returns `ELOOP` and the write never happens. This is atomic — there is no gap between the check and the write.

### Why all three are needed

`O_NOFOLLOW` only protects the **final** path component. It does not prevent traversal through symlinked parent directories. That's why `assertNoSymlinkedParents` exists.

`assertNoSymlinkedParents` is a TOCTOU check — between the lstat and the write, an attacker could theoretically swap a directory for a symlink. That's why `O_NOFOLLOW` exists as a final atomic gate.

Glob-level exclusion prevents symlinked content from appearing in listings and read results, even if the other two layers aren't reached.

## Dot-Path Rejection

Every path segment is checked: `filePath.split(path.sep).forEach(seg => seg.startsWith("."))`.

This blocks:
- `.obsidian/` (Obsidian plugins — code execution)
- `.git/` (git hooks — code execution)
- `.env`, `.npmrc` (secrets)
- `.hidden.md` (hidden data)
- `notes/.secret/file.md` (nested dot directories)

A simple `filePath.startsWith(".")` would only catch root-level dotfiles. The per-segment check catches them at any depth.

## Vault Path Handling

The vault path is resolved once at startup via `validateVaultPath`:

1. Reject falsy input
2. `path.resolve()` for an absolute path
3. `existsSync` check
4. `statSync` — must be a directory, not a file
5. `realpathSync` — resolve symlinks to get the canonical path

The resolved path is stored in module scope and exposed only through `getVaultPath()`, which throws if called before initialization.

### Vault containment check

```typescript
assertInsideVault(fullPath, vaultPath):
  fullPath must start with vaultPath + path.sep
```

The `+ path.sep` is critical. Without it, a vault at `/tmp/vault` would pass a file at `/tmp/vault-evil/escape.md` because it starts with `/tmp/vault`.

## Repo Path Handling

The repo path follows the same pattern as the vault path, with an additional git validation step:

1. Same 5-step validation as vault path (resolve, exists, isDirectory, realpath)
2. `execFileSync("git", ["rev-parse", "--git-dir"])` — confirms it's actually a git repository

The resolved path is stored in module scope and exposed only through `getRepoPath()`. The vault and repo are independent directories with independent immutable getters.

## Git Tool Security

Git tools use a separate security model from vault tools because they don't write files — they only run read-only git commands.

### Command execution

All git commands use `execFileSync("git", [...args])` — **never** `exec()` or a shell. This means:
- No shell metacharacter interpretation (`$()`, backticks, pipes, semicolons are literal strings)
- No environment variable expansion
- No glob expansion
- Arguments are passed directly to the git binary via `execvp`

Every command runs with `cwd` locked to the repo path and `--no-pager` to prevent hanging.

### Ref name validation

User-supplied git refs (branch names, tags, commit SHAs) are validated against an allowlist pattern:

```
/^[a-zA-Z0-9_.\\/\-~^@{}:]+$/
```

This allows standard git ref formats (`HEAD~1`, `origin/main`, `v1.0.0`, `HEAD^2`) while rejecting shell metacharacters, spaces, quotes, null bytes, and command substitution syntax.

### Path validation (gitBlame)

The `filePath` parameter in gitBlame goes through the full path validation chain:
1. `assertNoNullBytes` — reject null bytes
2. `path.resolve(repoPath, filePath)` — normalize to absolute
3. `assertInsideVault(fullPath, repoPath)` — containment check (reuses vault containment logic)
4. `assertNoSymlinkedParents(fullPath, repoPath)` — reject symlinked parent directories
5. `--` separator before the file path in the git command — prevents flag injection

### Output sanitization

All git output is processed before returning:
- The absolute repo path is replaced with `.` to prevent information leakage
- Output is capped at 100KB (`maxBuffer`) to prevent memory exhaustion
- Commands have a 10-second timeout to prevent hanging
- Errors go through `sanitizeError()` — never leak raw error details

## Error Sanitization

Node.js filesystem errors contain full paths, permission details, and OS information. We never return `error.message` directly.

```
ValidationError  → return the validation message (we control these)
ELOOP            → "Cannot write to a symbolic link"
ENOENT           → "File not found"
EACCES           → "Permission denied"
EISDIR           → "Expected a file, got a directory"
Everything else  → log to stderr, return "Failed to write file"
```

## Resource Limits

| Resource | Limit | Enforced by |
|----------|-------|-------------|
| Write content | 1 MB | Zod schema (`z.string().max(1_000_000)`) |
| File read size | 10 MB | `assertFileSize` (statSync before read) |
| Path length | 512 characters | `assertPathLimits` |
| Directory depth | 10 levels | `assertPathLimits` |
| Filenames per read request | 50 | Zod schema (`z.array().max(50)`) |
| Partial match results per query | 5 | Handler-level cap |

## Logging

MCP uses stdout for JSON-RPC. Any output on stdout after the transport connects corrupts the protocol.

All logging uses `console.error` (stderr). The startup banner, vault path confirmation, and all error details go to stderr only.

## Tested Attack Vectors

The server has been tested against 68 adversarial attack vectors across 15 attack surfaces. All attacks were blocked.

### Vault tools (`tests/security/adversarial.test.ts`) — 48 vectors

| Attack Surface | Vectors | Result |
|---------------|---------|--------|
| Path traversal & vault escape | `../`, absolute paths, URL-encoded, unicode normalization | All blocked |
| Code execution via Obsidian | `.obsidian/plugins/`, `.git/hooks/`, 20 executable extensions, double/triple extensions | All blocked |
| Symlink exploitation | TOCTOU race, chains, recursive, disguised symlinks | All blocked |
| Resource exhaustion | Depth bombs, content overflow, read amplification | All bounded |
| Information leakage | Error messages, dotfile exposure, path leakage | All sanitized |
| Content injection | JSON-RPC smuggling, null bytes, shell metacharacters | No execution |
| Dotfile bypass | Case variants, trailing dots, nested dotdirs | All blocked |
| Vault boundary | Prefix trick, root write | All blocked |
| Race conditions | 20 concurrent writes, contested file writes | No corruption |
| Creative attacks | Prototype pollution (`__proto__.md`), ANSI escapes, BOM, backslash traversal | All handled |

### Git tools (`tests/security/adversarial-git.test.ts`) — 20 vectors

| Attack Surface | Vectors | Result |
|---------------|---------|--------|
| Command injection via refs | `$(rm -rf /)`, backticks, semicolons, pipes, ampersands, newlines, null bytes, quotes | All blocked |
| Flag injection via filePath | `--exec=evil`, `-o /tmp/evil` disguised as filenames | All blocked |
| Path traversal via blame | `../../../etc/passwd`, absolute paths, null bytes, symlinked files | All blocked |
| Information leakage | Repo path stripped from gitStatus, gitLog, gitDiff, gitBlame output | All sanitized |
| Resource limits | Large diff output (10K lines) handled without crashing | Bounded |

## Reporting Vulnerabilities

If you find a security issue, please open a GitHub issue or contact the maintainer directly. Include:

1. Which tool is affected
2. The exact arguments you passed
3. What happened vs. what should have happened
