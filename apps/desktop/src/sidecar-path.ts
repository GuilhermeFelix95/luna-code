import * as path from "node:path";

const SIDECAR_NAME = "luna-sidecar";
const WINDOWS_EXECUTABLE_EXTENSION = ".exe";

// Caminho do binário em target/debug, relativo a apps/desktop/dist.
export function resolveSidecarBinary(
  distDir: string,
  platform: NodeJS.Platform,
): string {
  const extension = platform === "win32" ? WINDOWS_EXECUTABLE_EXTENSION : "";
  return path.resolve(
    distDir,
    "..",
    "..",
    "..",
    "target",
    "debug",
    `${SIDECAR_NAME}${extension}`,
  );
}
