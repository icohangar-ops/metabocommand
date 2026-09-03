use std::io::{self, Read};

use metabocommand_kernel::{handle_governance_request, GovernanceRequest};

fn main() {
    if let Err(error) = run() {
        eprintln!("{}", error);
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request: GovernanceRequest = serde_json::from_str(&input)?;
    let response = handle_governance_request(request);
    println!("{}", serde_json::to_string(&response)?);
    Ok(())
}
