use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalQueueName {
    Finance,
    Operations,
}

impl std::fmt::Display for ApprovalQueueName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApprovalQueueName::Finance => write!(f, "finance"),
            ApprovalQueueName::Operations => write!(f, "operations"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeniority {
    Junior,
    Professional,
    SeniorProfessional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WatchdogDecision {
    Pass,
    ApprovalRequired,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    Autonomous,
    Supervised,
    ApprovalRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentGovernanceProfile {
    pub agent_name: String,
    pub seniority: AgentSeniority,
    pub trust_level: TrustLevel,
    pub autonomous_limit: f64,
    pub approval_required_above: f64,
    pub decision_rights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogAssessment {
    pub decision: WatchdogDecision,
    pub seniority: AgentSeniority,
    pub trust_level: TrustLevel,
    pub policy_flags: Vec<String>,
    pub required_approvals: Vec<String>,
    pub autonomous_limit: f64,
    pub maximum_observed_amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceChecklistItem {
    pub label: String,
    pub status: EvidenceChecklistStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceChecklistStatus {
    Present,
    Required,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidencePacket {
    pub id: String,
    pub created_at: String,
    pub actor: EvidencePacketActor,
    pub intent: EvidencePacketIntent,
    pub watchdog: WatchdogAssessment,
    pub evidence_checklist: Vec<EvidenceChecklistItem>,
    pub source_commitments: Vec<String>,
    pub approval_boundary: String,
    pub attribution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidencePacketActor {
    pub agent_name: String,
    pub queue: ApprovalQueueName,
    pub seniority: AgentSeniority,
    pub trust_level: TrustLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidencePacketIntent {
    pub action_description: String,
    pub financial_impact: String,
    pub impact_amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceActionInput {
    pub agent_name: String,
    pub queue: ApprovalQueueName,
    pub action_description: String,
    pub financial_impact: String,
    pub impact_amount: Option<f64>,
}

fn default_profile(agent_name: &str) -> AgentGovernanceProfile {
    AgentGovernanceProfile {
        agent_name: agent_name.to_string(),
        seniority: AgentSeniority::Junior,
        trust_level: TrustLevel::ApprovalRequired,
        autonomous_limit: 0.0,
        approval_required_above: 0.0,
        decision_rights: vec![
            "Draft proposal".to_string(),
            "Assemble evidence".to_string(),
            "Queue approval".to_string(),
        ],
    }
}

fn agent_profiles(agent_name: &str) -> AgentGovernanceProfile {
    match agent_name {
        "Pulse Agent" => AgentGovernanceProfile {
            agent_name: "Pulse Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Detect anomalies".to_string(),
                "Recommend capital actions".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Oracle Agent" => AgentGovernanceProfile {
            agent_name: "Oracle Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Model scenarios".to_string(),
                "Rank forecast paths".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Sniper Agent" => AgentGovernanceProfile {
            agent_name: "Sniper Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 500.0,
            approval_required_above: 500.0,
            decision_rights: vec![
                "Identify waste".to_string(),
                "Auto-close low-risk spend".to_string(),
                "Queue higher-risk actions".to_string(),
            ],
        },
        "Conductor Agent" => AgentGovernanceProfile {
            agent_name: "Conductor Agent".to_string(),
            seniority: AgentSeniority::SeniorProfessional,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Coordinate capital flows".to_string(),
                "Resolve finance conflicts".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Acquisition Agent" => AgentGovernanceProfile {
            agent_name: "Acquisition Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 500.0,
            approval_required_above: 500.0,
            decision_rights: vec![
                "Optimize acquisition spend".to_string(),
                "Pause low-risk campaigns".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Conversion Agent" => AgentGovernanceProfile {
            agent_name: "Conversion Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Analyze tests".to_string(),
                "Recommend rollout".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Retention Agent" => AgentGovernanceProfile {
            agent_name: "Retention Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Segment churn risk".to_string(),
                "Draft campaigns".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Demand Prophet Agent" => AgentGovernanceProfile {
            agent_name: "Demand Prophet Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 10_000.0,
            approval_required_above: 10_000.0,
            decision_rights: vec![
                "Forecast demand".to_string(),
                "Auto-issue low-risk replenishment".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Logistics Conductor Agent" => AgentGovernanceProfile {
            agent_name: "Logistics Conductor Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Compare carriers".to_string(),
                "Recommend route changes".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Support Reflex Agent" => AgentGovernanceProfile {
            agent_name: "Support Reflex Agent".to_string(),
            seniority: AgentSeniority::Professional,
            trust_level: TrustLevel::Supervised,
            autonomous_limit: 35.0,
            approval_required_above: 35.0,
            decision_rights: vec![
                "Resolve low-value returns".to_string(),
                "Draft credits".to_string(),
                "Escalate human handoff".to_string(),
            ],
        },
        "Advocacy Agent" => AgentGovernanceProfile {
            agent_name: "Advocacy Agent".to_string(),
            seniority: AgentSeniority::Junior,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Identify advocates".to_string(),
                "Draft outreach".to_string(),
                "Queue approval".to_string(),
            ],
        },
        "Harmony Agent" => AgentGovernanceProfile {
            agent_name: "Harmony Agent".to_string(),
            seniority: AgentSeniority::SeniorProfessional,
            trust_level: TrustLevel::ApprovalRequired,
            autonomous_limit: 0.0,
            approval_required_above: 0.0,
            decision_rights: vec![
                "Coordinate agents".to_string(),
                "Detect conflicts".to_string(),
                "Queue approval".to_string(),
            ],
        },
        _ => default_profile(agent_name),
    }
}

fn money_values_from_text(text: &str) -> Vec<f64> {
    let re = Regex::new(r"\$([0-9][0-9,]*(?:\.[0-9]+)?)").expect("valid money regex");
    re.captures_iter(text)
        .filter_map(|caps| caps.get(1))
        .filter_map(|m| m.as_str().replace(',', "").parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .collect()
}

fn max_observed_amount(input: &GovernanceActionInput) -> f64 {
    let explicit = input.impact_amount.map(f64::abs).unwrap_or(0.0);
    let inferred = money_values_from_text(&format!(
        "{} {}",
        input.action_description, input.financial_impact
    ));
    inferred.into_iter().fold(explicit, f64::max)
}

fn packet_id(input: &GovernanceActionInput, created_at_millis: i64) -> String {
    let slug = slugify(&input.agent_name);
    format!(
        "evp_{}_{}_{}",
        input.queue,
        slug,
        to_base36(created_at_millis as u128)
    )
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;

    for ch in value.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(ch);
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn to_base36(mut value: u128) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }

    let mut buf = Vec::new();
    while value > 0 {
        let digit = (value % 36) as usize;
        buf.push(DIGITS[digit] as char);
        value /= 36;
    }
    buf.iter().rev().collect()
}

fn policy_flags(input: &GovernanceActionInput) -> Vec<String> {
    let inspected_text = format!("{} {}", input.action_description, input.financial_impact);
    let rules = [
        (
            "payment_affecting",
            r"(?i)\b(payment|pay|purchase|po|refund|credit|capital commitment|pre-purchase)\b",
        ),
        (
            "customer_impacting",
            r"(?i)\b(customer|campaign|win-back|discount|checkout|rollout|returns|review request)\b",
        ),
        (
            "vendor_or_contract_change",
            r"(?i)\b(vendor|carrier|contract|renegotiate|salesforce|supplier)\b",
        ),
        (
            "pricing_or_spend_change",
            r"(?i)\b(price|pricing|spend|ads|reallocate|cancel|pause|subscription)\b",
        ),
        (
            "irreversible_external_action",
            r"(?i)\b(sign contract|wire|ach|send money|execute payment|delete customer|terminate account)\b",
        ),
    ];

    rules
        .into_iter()
        .filter_map(|(id, pattern)| {
            Regex::new(pattern)
                .ok()
                .filter(|re| re.is_match(&inspected_text))
                .map(|_| id.to_string())
        })
        .collect()
}

fn required_approvals(queue: ApprovalQueueName, policy_flags: &[String]) -> Vec<String> {
    let mut approvals = Vec::new();
    let mut push_unique = |value: &str| {
        if !approvals.iter().any(|existing| existing == value) {
            approvals.push(value.to_string());
        }
    };

    match queue {
        ApprovalQueueName::Finance => push_unique("CFO"),
        ApprovalQueueName::Operations => push_unique("Operations Lead"),
    }

    if policy_flags.iter().any(|flag| flag == "payment_affecting") {
        push_unique("Finance Owner");
    }
    if policy_flags.iter().any(|flag| flag == "customer_impacting") {
        push_unique("Customer/Operations Owner");
    }
    if policy_flags
        .iter()
        .any(|flag| flag == "vendor_or_contract_change")
    {
        push_unique("Vendor/Legal Owner");
    }

    approvals
}

pub fn get_agent_governance_profile(agent_name: &str) -> AgentGovernanceProfile {
    agent_profiles(agent_name)
}

pub fn assess_governance_action(input: &GovernanceActionInput) -> WatchdogAssessment {
    let profile = get_agent_governance_profile(&input.agent_name);
    let policy_flags = policy_flags(input);
    let observed_amount = max_observed_amount(input);
    let crosses_limit = observed_amount > profile.autonomous_limit;
    let requires_approval = !policy_flags.is_empty()
        || profile.trust_level == TrustLevel::ApprovalRequired
        || crosses_limit;

    let decision = if policy_flags
        .iter()
        .any(|flag| flag == "irreversible_external_action")
    {
        WatchdogDecision::Blocked
    } else if requires_approval {
        WatchdogDecision::ApprovalRequired
    } else {
        WatchdogDecision::Pass
    };

    let policy_flags = if policy_flags.is_empty() {
        vec!["no_high_impact_flag_detected".to_string()]
    } else {
        policy_flags
    };

    WatchdogAssessment {
        decision,
        seniority: profile.seniority,
        trust_level: profile.trust_level,
        policy_flags: policy_flags.clone(),
        required_approvals: required_approvals(input.queue, &policy_flags),
        autonomous_limit: profile.autonomous_limit,
        maximum_observed_amount: observed_amount,
    }
}

pub fn build_evidence_packet(input: &GovernanceActionInput) -> EvidencePacket {
    let assessment = assess_governance_action(input);
    let profile = get_agent_governance_profile(&input.agent_name);
    let created_at = Utc::now();
    let created_at_millis = created_at.timestamp_millis();
    let decision = assessment.decision;

    EvidencePacket {
        id: packet_id(input, created_at_millis),
        created_at: created_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        actor: EvidencePacketActor {
            agent_name: input.agent_name.clone(),
            queue: input.queue,
            seniority: profile.seniority,
            trust_level: profile.trust_level,
        },
        intent: EvidencePacketIntent {
            action_description: input.action_description.clone(),
            financial_impact: input.financial_impact.clone(),
            impact_amount: input.impact_amount,
        },
        watchdog: assessment,
        evidence_checklist: vec![
            EvidenceChecklistItem {
                label: "Agent identity and queue role verified".to_string(),
                status: EvidenceChecklistStatus::Present,
            },
            EvidenceChecklistItem {
                label: "Business intent captured before tool execution".to_string(),
                status: EvidenceChecklistStatus::Present,
            },
            EvidenceChecklistItem {
                label: "Financial/customer/vendor impact classified".to_string(),
                status: EvidenceChecklistStatus::Present,
            },
            EvidenceChecklistItem {
                label: "Human approval recorded before external execution".to_string(),
                status: EvidenceChecklistStatus::Required,
            },
            EvidenceChecklistItem {
                label: "Rollback or reversal path documented by owner".to_string(),
                status: EvidenceChecklistStatus::Required,
            },
        ],
        source_commitments: vec![
            "Approval item payload".to_string(),
            "Role-scoped Supabase profile".to_string(),
            "Agent seniority profile".to_string(),
            "MetaboCommand Watchdog policy bundle".to_string(),
        ],
        approval_boundary: if matches!(decision, WatchdogDecision::Pass) {
            "Action may remain autonomous within the configured limit.".to_string()
        } else {
            "Action must stay in the approval queue until an authorized human decision is recorded.".to_string()
        },
        attribution: "Runtime enforcement, evidence-packet, and seniority-rights patterns adapted from Georgios Fradelos, PhD, Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees, Geneva, January 9, 2026.".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "command", content = "input", rename_all = "snake_case")]
pub enum GovernanceRequest {
    GetAgentGovernanceProfile { agent_name: String },
    AssessGovernanceAction(GovernanceActionInput),
    BuildEvidencePacket(GovernanceActionInput),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum GovernanceResponse {
    AgentGovernanceProfile(AgentGovernanceProfile),
    WatchdogAssessment(WatchdogAssessment),
    EvidencePacket(EvidencePacket),
}

pub fn handle_governance_request(request: GovernanceRequest) -> GovernanceResponse {
    match request {
        GovernanceRequest::GetAgentGovernanceProfile { agent_name } => {
            GovernanceResponse::AgentGovernanceProfile(get_agent_governance_profile(&agent_name))
        }
        GovernanceRequest::AssessGovernanceAction(input) => {
            GovernanceResponse::WatchdogAssessment(assess_governance_action(&input))
        }
        GovernanceRequest::BuildEvidencePacket(input) => {
            GovernanceResponse::EvidencePacket(build_evidence_packet(&input))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(
        agent_name: &str,
        action: &str,
        impact: &str,
        amount: Option<f64>,
    ) -> GovernanceActionInput {
        GovernanceActionInput {
            agent_name: agent_name.to_string(),
            queue: ApprovalQueueName::Finance,
            action_description: action.to_string(),
            financial_impact: impact.to_string(),
            impact_amount: amount,
        }
    }

    #[test]
    fn flags_irreversible_external_action_as_blocked() {
        let assessment = assess_governance_action(&input(
            "Pulse Agent",
            "Execute payment to vendor",
            "$500",
            Some(500.0),
        ));
        assert_eq!(assessment.decision, WatchdogDecision::Blocked);
    }

    #[test]
    fn allows_small_sniper_action_with_no_flags() {
        let assessment = assess_governance_action(&input(
            "Sniper Agent",
            "Update low-risk ad set",
            "Reduce cost by $100",
            Some(100.0),
        ));
        assert_eq!(assessment.decision, WatchdogDecision::Pass);
        assert_eq!(
            assessment.policy_flags,
            vec!["no_high_impact_flag_detected".to_string()]
        );
    }

    #[test]
    fn builds_evidence_packet_with_stable_shapes() {
        let packet = build_evidence_packet(&input(
            "Conductor Agent",
            "Renegotiate vendor contract",
            "Potential $12,000 annual savings",
            Some(12_000.0),
        ));
        assert_eq!(packet.actor.queue, ApprovalQueueName::Finance);
        assert_eq!(packet.watchdog.decision, WatchdogDecision::ApprovalRequired);
        assert!(!packet.id.is_empty());
        assert!(packet.approval_boundary.contains("approval queue"));
    }
}
