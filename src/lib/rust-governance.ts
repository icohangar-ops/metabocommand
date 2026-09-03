import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let cachedBinary: string | null = null;

function resolveBinary() {
  if (cachedBinary) {
    return cachedBinary;
  }

  const releaseBinary = join(ROOT, "target", "release", "metabocommand-governance");
  const debugBinary = join(ROOT, "target", "debug", "metabocommand-governance");
  if (existsSync(releaseBinary)) {
    cachedBinary = releaseBinary;
    return cachedBinary;
  }
  if (existsSync(debugBinary)) {
    cachedBinary = debugBinary;
    return cachedBinary;
  }

  cachedBinary = "cargo";
  return cachedBinary;
}

export function runGovernanceCore(command: string, input: Record<string, unknown>) {
  const payload = JSON.stringify({ command, input });
  const binary = resolveBinary();

  const output =
    binary === "cargo"
      ? execFileSync(
          binary,
          ["run", "--quiet", "--bin", "metabocommand-governance", "--manifest-path", join(ROOT, "Cargo.toml")],
          { input: payload, encoding: "utf8" }
        )
      : execFileSync(binary, [], { input: payload, encoding: "utf8" });

  return JSON.parse(output);
}
