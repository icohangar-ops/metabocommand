//! # metabocommand-kernel
//!
//! Pure computation kernels for the MetaboCommand platform.
//! Handles escalation management, velocity scoring, CSV generation, and governance.
//! Designed for WASM target — no I/O, no async, pure functions only.

pub mod csv_builder;
pub mod escalation;
pub mod governance;
pub mod types;
pub mod velocity;

pub use csv_builder::CsvBuilder;
pub use escalation::*;
pub use governance::*;
pub use types::*;
pub use velocity::*;
