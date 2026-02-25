import { describe, it, expect } from "vitest";
import {
  assertNoNullBytes,
  assertNoDotPaths,
  assertAllowedExtension,
  assertPathLimits,
  assertInsideVault,
  ValidationError,
} from "../../src/core/index.js";

describe("assertNoNullBytes", () => {
  it("allows normal paths", () => {
    expect(() => assertNoNullBytes("notes/hello.md")).not.toThrow();
  });

  it("rejects null bytes", () => {
    expect(() => assertNoNullBytes("notes/hello\0.md")).toThrow(ValidationError);
  });
});

describe("assertNoDotPaths", () => {
  it("allows normal paths", () => {
    expect(() => assertNoDotPaths("notes/hello.md")).not.toThrow();
  });

  it("rejects root dotfiles", () => {
    expect(() => assertNoDotPaths(".obsidian/plugins.json")).toThrow(ValidationError);
  });

  it("rejects nested dotdirs", () => {
    expect(() => assertNoDotPaths("notes/.secret/file.md")).toThrow(ValidationError);
  });
});

describe("assertAllowedExtension", () => {
  it.each([".md", ".canvas"])(
    "allows %s",
    (ext) => {
      expect(() => assertAllowedExtension(`file${ext}`)).not.toThrow();
    }
  );

  it.each([".js", ".sh", ".py", ".exe", ".html", ".txt", ".csv", ".json", ".yaml", ".yml"])(
    "rejects %s",
    (ext) => {
      expect(() => assertAllowedExtension(`file${ext}`)).toThrow(ValidationError);
    }
  );
});

describe("assertPathLimits", () => {
  it("allows short paths", () => {
    expect(() => assertPathLimits("notes/hello.md")).not.toThrow();
  });

  it("rejects paths over 512 chars", () => {
    const long = "a".repeat(513);
    expect(() => assertPathLimits(long)).toThrow(ValidationError);
  });

  it("rejects paths deeper than 10 levels", () => {
    const deep = Array(11).fill("dir").join("/") + "/file.md";
    expect(() => assertPathLimits(deep)).toThrow(ValidationError);
  });
});

describe("assertInsideVault", () => {
  const vault = "/home/user/vault";

  it("allows paths inside vault", () => {
    expect(() => assertInsideVault("/home/user/vault/notes/a.md", vault)).not.toThrow();
  });

  it("rejects paths outside vault", () => {
    expect(() => assertInsideVault("/home/user/other/a.md", vault)).toThrow(ValidationError);
  });

  it("rejects prefix-trick paths", () => {
    // /home/user/vault-evil should NOT pass
    expect(() => assertInsideVault("/home/user/vault-evil/a.md", vault)).toThrow(ValidationError);
  });
});
