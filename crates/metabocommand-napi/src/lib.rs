//! Node.js native binding for the `metabocommand-kernel` governance engine.
//!
//! Exposes the kernel's JSON governance contract (`GovernanceRequest` ->
//! `GovernanceResponse`) as a synchronous N-API function so the Next.js server
//! can call the Rust kernel in-process instead of spawning the
//! `metabocommand-governance` CLI as a subprocess.
//!
//! The wire format is byte-for-byte the same one the CLI binary speaks, so the
//! TypeScript watchdog wrapper needs no transport-specific mapping.

use napi::{Error, Result, Status};
use napi_derive::napi;

use metabocommand_kernel::{handle_governance_request, GovernanceRequest};

/// Run a governance command against the Rust kernel.
///
/// - `command`: one of `get_agent_governance_profile`, `assess_governance_action`,
///   or `build_evidence_packet`.
/// - `input_json`: JSON payload for the command — `{ agent_name }` for profile
///   lookups, or a kernel `GovernanceActionInput` object otherwise.
///
/// Returns the JSON-encoded kernel `GovernanceResponse` (an envelope of
/// `{ kind, value }`), identical to what the CLI binary prints on stdout.
///
/// Throws `InvalidArg` for unknown commands or malformed inputs, mirroring the
/// CLI's hard exit when the request fails to deserialize.
#[napi]
pub fn governance_command(command: String, input_json: String) -> Result<String> {
    let input: serde_json::Value = serde_json::from_str(&input_json)
        .map_err(|error| Error::new(Status::InvalidArg, format!("invalid input JSON: {error}")))?;

    let request: GovernanceRequest = serde_json::from_value(serde_json::json!({
        "command": command,
        "input": input,
    }))
    .map_err(|error| {
        Error::new(
            Status::InvalidArg,
            format!("unknown governance command or malformed input: {error}"),
        )
    })?;

    serde_json::to_string(&handle_governance_request(request)).map_err(|error| {
        Error::new(
            Status::GenericFailure,
            format!("failed to encode governance response: {error}"),
        )
    })
}
