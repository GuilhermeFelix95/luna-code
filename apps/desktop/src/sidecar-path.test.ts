import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSidecarBinary } from "./sidecar-path";

describe("resolveSidecarBinary", () => {
  it("usa .exe no Windows", () => {
    const distDir = path.resolve("repo", "apps", "desktop", "dist");

    expect(resolveSidecarBinary(distDir, "win32")).toBe(
      path.resolve("repo", "target", "debug", "luna-sidecar.exe"),
    );
  });

  it("não usa extensão fora do Windows", () => {
    const distDir = path.resolve("repo", "apps", "desktop", "dist");

    expect(resolveSidecarBinary(distDir, "linux")).toBe(
      path.resolve("repo", "target", "debug", "luna-sidecar"),
    );
  });
});
