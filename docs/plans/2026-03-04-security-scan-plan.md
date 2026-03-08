# Security Scan Implementation Plan — 2026-03-04

**Vault doc**: `Basalt MCP Security Scan 2026-03-04.md`
**Total tasks**: 18 findings | **Total new tests**: ~20
**Test command**: `npx vitest run`

---

## Phase 1 — CRIT (Fix immediately, before any release)

### Task 1.1 — Fix ReDoS in searchVault (SEC-CRIT-1)
**Files**: `src/tools/obsidian/searchVault.ts`, `package.json`, `tests/security/adversarial.test.ts`
**Finding**: `new RegExp(input.query, "i")` runs JavaScript's backtracking engine with no time bound. Confirmed: 30-char payload blocks event loop for 84 seconds.
**Fix**:
1. Add `re2` dependency: `npm install re2` (linear-time regex, V8-compatible API)
2. In `searchVault.ts`: `import RE2 from "re2";` and replace `new RegExp(...)` with `new RE2(...)`
3. Alternative if `re2` is unacceptable (requires native compile): enforce a per-line length cap before testing: `if (lines[i].length > 100_000) continue;` and add a `MAX_REGEX_COMPLEXITY` guard

**New tests** (2): ReDoS pattern against long string completes in < 1s; invalid regex still throws ValidationError

---

## Phase 2 — HIGH (Fix before next minor release)

### Task 2.1 — Add gpg.program and log.showSignature to CONFIG_OVERRIDES (SEC-HIGH-1)
**Files**: `src/tools/git/exec.ts`, `tests/security/adversarial-git.test.ts`
**Finding**: Missing config overrides allow code execution via `gpg.program` when `log.showSignature=true` in malicious `.git/config`.
**Fix**: Add to `CONFIG_OVERRIDES` array:
```typescript
"-c", "log.showSignature=false",
"-c", "gpg.program=",
"-c", "gpg.ssh.defaultKeyCommand=",
"-c", "gpg.ssh.allowedSignersFile=",
"-c", "tag.gpgSign=false",
```

**New tests** (2): Create temp repo with malicious `.git/config` (showSignature=true, gpg.program=evil.sh); call `gitLog`; assert evil.sh not executed; assert output is returned normally

### Task 2.2 — Add assertNoDotPaths to gitBlame (SEC-HIGH-2)
**Files**: `src/tools/git/gitBlame.ts`, `tests/security/adversarial-git.test.ts`
**Finding**: `gitBlame` missing `assertNoDotPaths` — allows blame of `.github/workflows/*.yml`, `.env`, `.git/config` etc.
**Fix**: Add after line 35 (assertNoNullBytes call):
```typescript
import { assertNoNullBytes, assertNoDotPaths, assertInsideVault, assertNoSymlinkedParents, ... } from "../../core/index.js";
// after assertNoNullBytes(input.filePath):
assertNoDotPaths(input.filePath);
```

**New tests** (3): `gitBlame(".git/config")` → ValidationError; `gitBlame(".github/workflows/ci.yml")` → ValidationError; `gitBlame("subdir/.env")` → ValidationError

---

## Phase 3 — MED (Fix in next sprint)

### Task 3.1 — Fix assertSafeRef to throw ValidationError (SEC-MED-1)
**Files**: `src/tools/git/exec.ts`, `tests/security/adversarial-git.test.ts`
**Finding**: `assertSafeRef` throws plain `Error` — MCP SDK may surface stack trace with absolute paths to AI.
**Fix**: Change `throw new Error(...)` to `throw new ValidationError(...)` in `assertSafeRef`. Import `ValidationError` from `../../core/index.js`.

**New tests** (1): `gitDiff({ ref: "../../etc/passwd" })` rejects with message not containing a file path or stack trace

### Task 3.2 — Update filenames trust classification (SEC-MED-2)
**Files**: `src/index.ts`, `src/tools/obsidian/getAllFilenames.ts`, `src/tools/obsidian/listFiles.ts`
**Finding**: `getAllFilenames` and `listFiles` return filenames as `contentTrust: "trusted"` without boundary markers; filenames are user-controlled strings.
**Fix** (Option A — wrap filenames):
- Change `contentTrust: "trusted"` to `"untrusted"` for both tools
- Wrap each filename in `wrapUntrustedContent`
**Fix** (Option B — description warning):
- Keep trust classification but update both tool descriptions to explicitly warn about adversarial filenames

**New tests** (1): Create file with injection string in name; verify `getAllFilenames` either wraps in boundary markers or has description warning

### Task 3.3 — Restrict SAFE_ENV to allowlist (SEC-MED-3)
**Files**: `src/tools/git/exec.ts`, `tests/security/adversarial-git.test.ts`
**Finding**: `...process.env` propagates API keys, tokens, and dangerous git env vars to git subprocess.
**Fix**: Replace `...process.env` with explicit allowlist (PATH, HOME, TMPDIR, LANG). Add GIT_EXEC_PATH, GIT_DIR, GIT_OBJECT_DIRECTORY, GIT_CONFIG_PARAMETERS, GIT_NAMESPACE as empty-string neutralizations.

**New tests** (1): Set synthetic secret in process.env; call gitStatus; verify git subprocess does not receive it

### Task 3.4 — Remove author emails from git output (SEC-MED-4)
**Files**: `src/tools/git/gitLog.ts`, `src/tools/git/gitBlame.ts`
**Finding**: `%ae` in gitLog format and default blame output expose contributor emails (PII).
**Fix**:
- `gitLog.ts`: Change `--format=%H %ae %aI%n%s%n` to `--format=%H %an %aI%n%s%n` (name instead of email)
- `gitBlame.ts`: Add `--porcelain` flag and filter `author-mail` lines from output

**New tests** (1): Assert gitLog output does not contain strings matching email pattern `@`

### Task 3.5 — Block .. in assertSafeRef (SEC-MED-5)
**Files**: `src/tools/git/exec.ts`, `tests/security/adversarial-git.test.ts`
**Finding**: `../../../etc/passwd` passes `SAFE_REF_PATTERN` (git rejects it, but pattern should be explicit).
**Fix**: Add before pattern test:
```typescript
if (ref.includes("../")) {
  throw new ValidationError("Invalid git ref: contains disallowed characters");
}
```

**New tests** (2): `assertSafeRef("../../etc/passwd")` throws; `assertSafeRef("main..HEAD")` passes

---

## Phase 4 — LOW (Fix during related work)

### Task 4.1 — Fix appendToFile TOCTOU read (SEC-LOW-1)
**Files**: `src/tools/obsidian/appendToFile.ts`
**Fix**: Open file with `O_RDONLY | O_NOFOLLOW` before reading for newline detection; read via fd.
**Tests**: 1 — verify atomic read does not follow symlinks

### Task 4.2 — Add _meta envelope to git tools (SEC-LOW-2)
**Files**: `src/index.ts` (git tool registrations)
**Fix**: Wrap git tool returns in JSON envelope with `_meta: { source: "repo", contentTrust: "untrusted", warning: "..." }`.
**Tests**: 1 — verify git tool response is valid JSON with contentTrust field

### Task 4.3 — Strip absolute paths from error log detail (SEC-LOW-3)
**Files**: `src/core/errors.ts`
**Fix**: In `logError`, apply path-stripping to `detail` field: `detail.replace(/\/[^\s:,]+/g, "<path>")`.
**Tests**: 1 — capture stderr on EPERM error; verify no absolute path in detail field

### Task 4.4 — Wrap getOpenTodos file field (SEC-LOW-4)
**Files**: `src/tools/obsidian/getOpenTodos.ts`
**Fix**: Wrap `relPath` in `wrapUntrustedContent` in TodoItem construction. (Consistent with SEC-MED-2 fix.)
**Tests**: 1 — verify file field is boundary-wrapped

### Task 4.5 — Fix readMultipleFiles not-found key reflection (SEC-LOW-5)
**Files**: `src/tools/obsidian/readMultipleFiles.ts`
**Fix**: Replace `results[query] = "[not found]"` with a separate `notFound: string[]` array in the result envelope.
**Tests**: 1 — call with injection-string filename; verify it does not appear verbatim as JSON key

### Task 4.6 — Clean up orphaned dirs in updateFileContent (SEC-LOW-6)
**Files**: `src/tools/obsidian/updateFileContent.ts`
**Fix**: Track newly created dirs before mkdirSync; remove them in catch block if write fails.
**Tests**: 1 — verify no orphaned directories after failed write

### Task 4.7 — Remove absolute paths from startup logs (SEC-LOW-7)
**Files**: `src/index.ts:89,100`
**Fix**: Log `path.basename(vaultPath)` instead of full path.
**Tests**: No automated test; manual verification

### Task 4.8 — Remove absolute paths from fatal error messages (SEC-LOW-8)
**Files**: `src/core/vault.ts:21`, `src/core/repo.ts:23`
**Fix**: Remove `${absolute}` from error message strings.
**Tests**: 1 — verify thrown error message does not contain the input path

### Task 4.9 — Restrict listFiles extension to ALLOWED_EXTENSIONS (SEC-LOW-9)
**Files**: `src/tools/obsidian/listFiles.ts`
**Fix**: Add `if (!ALLOWED_EXTENSIONS.has(ext)) throw new ValidationError(...)` before filter.
**Tests**: 1 — `listFiles({ extension: ".sh" })` throws ValidationError

### Task 4.10 — Pin production dependency versions (SEC-LOW-10)
**Files**: `package.json`
**Fix**: Change `^1.27.1` → `1.27.1`, `^13.0.6` → `13.0.6`, `^4.3.6` → `4.3.6`. Add `npm ci` to CI docs.
**Tests**: No automated test; package.json validation

---

## Summary

| Phase | Severity | Tasks | New Tests | Priority |
|-------|----------|-------|-----------|----------|
| 1     | CRIT     | 1     | 2         | Immediate |
| 2     | HIGH     | 2     | 5         | Before next release |
| 3     | MED      | 5     | 6         | Next sprint |
| 4     | LOW      | 10    | ~10       | During related work |
| **Total** | | **18** | **~23** | |
