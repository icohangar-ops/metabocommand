# ADR 0001 — Bind the governance kernel to the Next.js server with napi-rs

- **Status:** Accepted (2026-09-20)
- **Deciders:** MetaboCommand maintainers
- **Trigger:** CFO/ERP portfolio architecture review finding — the Rust kernel was
  not wired to the app; governance rules existed twice (Rust kernel + TS), and
  the only bridge spawned the kernel CLI as a subprocess per call.

## Context

Governance rules (agent seniority profiles, watchdog policy flags, approval
decisions, evidence-packet generation) are owned by
`crates/metabocommand-kernel`. Every consumer of those rules executes
server-side in Node:

- the route handler `src/app/api/approvals/submit/route.ts`
  (`buildEvidencePacket` before every approval insert),
- the MCP server `scripts/mcp-server.ts` (`node --experimental-strip-types`),
- the test suites run by `npm run test:governance` (`node --test`).

Nothing in the browser evaluates governance rules. The pre-existing bridge
(`src/lib/rust-governance.ts`) shelled out to the `metabocommand-governance`
CLI binary — or to `cargo run`, compiling on demand — once per call, and
couldn't be built at all under Turbopack (`new URL("../../", import.meta.url)`
is parsed as an unresolvable asset import).

## Options considered

1. **Subprocess bridge (status quo ante)** — spawn the kernel CLI per call.
   Rejected as the production path: needs a Rust toolchain wherever the server
   runs, pays a process spawn + JSON round-trip per governance decision, and
   had no artifact story for deployments.
2. **wasm-pack** — the kernel is written "for WASM target" (no I/O, pure
   functions), and a `.wasm` artifact would also run in the browser. Rejected
   for this wiring: there is no client-side consumer of the governance rules
   today, so a wasm artifact would add a second build toolchain without a
   reader. Revisit if client-side rule evaluation becomes real (candidates:
   the client CSV exporter in `src/lib/csv.ts` and the support-escalation
   summary in `src/lib/support-orchestration.ts`, which still duplicate small
   kernel rules client-side).
3. **napi-rs (chosen)** — synchronous in-process call from Node, no runtime
   toolchain, one artifact per platform, and it ships the exact JSON
   `GovernanceRequest`/`GovernanceResponse` contract the CLI already spoke, so
   results are pinned by the same tests either way.

## Decision

Add `crates/metabocommand-napi` (cdylib, `napi` 2.x) exposing one function,
`governanceCommand(command, inputJson) -> string`, which deserializes into the
kernel's `GovernanceRequest`, calls `handle_governance_request`, and returns
the serialized `GovernanceResponse`. The TS loader
(`src/lib/rust-governance.ts`) prefers the compiled artifact from `native/`
(overridable via `METABOCOMMAND_NATIVE_PATH` / `METABOCOMMAND_ROOT`) and keeps
the subprocess CLI as a dev-only fallback that logs a warning when used.

Build with `npm run build:napi` (requires a Rust toolchain). See the README
section "Rust governance kernel (napi binding)" for artifact locations.

## Consequences

- Governance rules exist in exactly one place; the TS watchdog layer is a
  transport + naming shim with no rule logic.
- Production calls are in-process — no toolchain on the server, no subprocess
  latency.
- Platform-specific `.node` artifacts must be built per deploy target;
  `next.config.ts` includes `native/**` in `outputFileTracingIncludes` so
  traced output keeps the artifact.
- The subprocess fallback stays for fresh checkouts; it is transport-only and
  observable (one-time warning).

## Verification

- `cargo test` (kernel unit tests + velocity pipeline) and
  `npm run test:governance` / `npm run test:stigmergy` are green with the napi
  transport active.
- Kernel outputs captured through the napi binding are identical to the
  subprocess-bridge outputs, normalizing only the timestamp-volatile
  `id`/`created_at` fields of evidence packets.
