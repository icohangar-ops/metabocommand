// Transport layer between the TypeScript watchdog wrapper and the Rust kernel.
//
// All governance rules live in crates/metabocommand-kernel (and only there).
// This module contains no rule logic — it selects a transport for the kernel's
// JSON `GovernanceRequest` / `GovernanceResponse` contract:
//
//   1. the compiled napi-rs binding (`npm run build:napi` → native/*.node),
//      which calls the kernel in-process — the path used in production; or
//   2. a dev fallback that shells out to the kernel CLI
//      (target/release/metabocommand-governance → target/debug → `cargo run`).
//
// Both transports speak the identical wire format, so results are pinned by
// the same test suite either way.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export type GovernanceTransport = "napi" | "subprocess";

/** Typed shape of the napi binding exported by crates/metabocommand-napi. */
interface GovernanceNativeBinding {
  governanceCommand(command: string, inputJson: string): string;
}

/** Kernel response envelope: `{ kind, value }` (see GovernanceResponse). */
export interface GovernanceCoreResponse {
  kind: "agent_governance_profile" | "watchdog_assessment" | "evidence_packet";
  value: unknown;
}

type LoadedTransport =
  | { kind: "napi"; binding: GovernanceNativeBinding }
  | { kind: "subprocess" };

// The repo root that contains native/ and the Cargo workspace. Defaults to the
// process working directory (repo root for `next dev`, `next start`, npm
// scripts); override for non-standard deployments.
const ROOT = process.env.METABOCOMMAND_ROOT ?? process.cwd();

// platform/arch → napi artifact triples, matching `npm run build:napi` output.
const PLATFORM_TRIPLES: Record<string, Record<string, string[]>> = {
  linux: { x64: ["linux-x64-gnu", "linux-x64-musl"] },
  darwin: { x64: ["darwin-x64"], arm64: ["darwin-arm64"] },
  win32: { x64: ["win32-x64-msvc"] },
};

let loadedTransport: LoadedTransport | null = null;
let warnedFallback = false;

function nativeCandidates(): string[] {
  const override = process.env.METABOCOMMAND_NATIVE_PATH;
  if (override) {
    return [override];
  }

  const triples = PLATFORM_TRIPLES[process.platform]?.[process.arch] ?? [];
  const candidates = triples.map((triple) =>
    join(ROOT, "native", `metabocommand.${triple}.node`)
  );
  // Generic name for a locally built binding without --platform naming.
  candidates.push(join(ROOT, "native", "index.node"));
  return candidates;
}

function loadNativeBinding(): GovernanceNativeBinding | null {
  for (const candidate of nativeCandidates()) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      // createRequire loads the .node artifact from disk at runtime, keeping
      // it out of the bundler graph entirely.
      const require = createRequire(join(ROOT, "package.json"));
      return require(candidate) as GovernanceNativeBinding;
    } catch (error) {
      throw new Error(
        `Failed to load governance native binding at ${candidate}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return null;
}

function getTransport(): LoadedTransport {
  if (loadedTransport) {
    return loadedTransport;
  }

  const binding = loadNativeBinding();
  if (binding) {
    loadedTransport = { kind: "napi", binding };
    return loadedTransport;
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      `[rust-governance] native binding not found (looked for: ${nativeCandidates().join(", ")}); ` +
        "falling back to the kernel CLI subprocess. Run `npm run build:napi` " +
        "to build the in-process binding."
    );
  }
  loadedTransport = { kind: "subprocess" };
  return loadedTransport;
}

function resolveCliBinary(): string {
  const releaseBinary = join(ROOT, "target", "release", "metabocommand-governance");
  const debugBinary = join(ROOT, "target", "debug", "metabocommand-governance");
  if (existsSync(releaseBinary)) {
    return releaseBinary;
  }
  if (existsSync(debugBinary)) {
    return debugBinary;
  }
  return "cargo";
}

function runSubprocessCli(command: string, inputJson: string): string {
  const binary = resolveCliBinary();
  const payload = `{"command":${JSON.stringify(command)},"input":${inputJson}}`;

  return binary === "cargo"
    ? execFileSync(
        binary,
        ["run", "--quiet", "--bin", "metabocommand-governance", "--manifest-path", join(ROOT, "Cargo.toml")],
        { input: payload, encoding: "utf8" }
      )
    : execFileSync(binary, [], { input: payload, encoding: "utf8" });
}

/** Which transport the next kernel call will use (diagnostics/testing hook). */
export function getGovernanceTransport(): GovernanceTransport {
  return getTransport().kind;
}

/** Run one governance command against the Rust kernel. */
export function runGovernanceCore(
  command: string,
  input: Record<string, unknown>
): GovernanceCoreResponse {
  const transport = getTransport();
  const inputJson = JSON.stringify(input);

  const responseJson =
    transport.kind === "napi"
      ? transport.binding.governanceCommand(command, inputJson)
      : runSubprocessCli(command, inputJson);

  return JSON.parse(responseJson) as GovernanceCoreResponse;
}
