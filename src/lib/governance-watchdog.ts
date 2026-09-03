export type ApprovalQueueName = "finance" | "operations";

export type AgentSeniority = "junior" | "professional" | "senior_professional";
export type WatchdogDecision = "pass" | "approval_required" | "blocked";
export type TrustLevel = "autonomous" | "supervised" | "approval_required";

export interface AgentGovernanceProfile {
  agentName: string;
  seniority: AgentSeniority;
  trustLevel: TrustLevel;
  autonomousLimit: number;
  approvalRequiredAbove: number;
  decisionRights: string[];
}

export interface WatchdogAssessment {
  decision: WatchdogDecision;
  seniority: AgentSeniority;
  trustLevel: TrustLevel;
  policyFlags: string[];
  requiredApprovals: string[];
  autonomousLimit: number;
  maximumObservedAmount: number;
}

export interface EvidenceChecklistItem {
  label: string;
  status: "present" | "required" | "not_applicable";
}

export interface EvidencePacket {
  id: string;
  created_at: string;
  actor: {
    agent_name: string;
    queue: ApprovalQueueName;
    seniority: AgentSeniority;
    trust_level: TrustLevel;
  };
  intent: {
    action_description: string;
    financial_impact: string;
    impact_amount: number | null;
  };
  watchdog: WatchdogAssessment;
  evidence_checklist: EvidenceChecklistItem[];
  source_commitments: string[];
  approval_boundary: string;
  attribution: string;
}

export interface GovernanceActionInput {
  agentName: string;
  queue: ApprovalQueueName;
  actionDescription: string;
  financialImpact: string;
  impactAmount?: number | null;
}
import { runGovernanceCore } from "./rust-governance.ts";

type RawProfile = {
  agent_name: string;
  seniority: AgentSeniority;
  trust_level: TrustLevel;
  autonomous_limit: number;
  approval_required_above: number;
  decision_rights: string[];
};

type RawAssessment = {
  decision: WatchdogDecision;
  seniority: AgentSeniority;
  trust_level: TrustLevel;
  policy_flags: string[];
  required_approvals: string[];
  autonomous_limit: number;
  maximum_observed_amount: number;
};

type RawEvidencePacket = Omit<EvidencePacket, "watchdog"> & { watchdog: RawAssessment };

function toProfile(raw: RawProfile): AgentGovernanceProfile {
  return {
    agentName: raw.agent_name,
    seniority: raw.seniority,
    trustLevel: raw.trust_level,
    autonomousLimit: raw.autonomous_limit,
    approvalRequiredAbove: raw.approval_required_above,
    decisionRights: raw.decision_rights,
  };
}

function toAssessment(raw: RawAssessment): WatchdogAssessment {
  return {
    decision: raw.decision,
    seniority: raw.seniority,
    trustLevel: raw.trust_level,
    policyFlags: raw.policy_flags,
    requiredApprovals: raw.required_approvals,
    autonomousLimit: raw.autonomous_limit,
    maximumObservedAmount: raw.maximum_observed_amount,
  };
}

function toPacket(raw: RawEvidencePacket): EvidencePacket {
  return {
    ...raw,
    watchdog: toAssessment(raw.watchdog),
  };
}

export function getAgentGovernanceProfile(agentName: string): AgentGovernanceProfile {
  return toProfile(runGovernanceCore("get_agent_governance_profile", { agent_name: agentName }).value as RawProfile);
}

export function assessGovernanceAction(input: GovernanceActionInput): WatchdogAssessment {
  return toAssessment(runGovernanceCore("assess_governance_action", {
    agent_name: input.agentName,
    queue: input.queue,
    action_description: input.actionDescription,
    financial_impact: input.financialImpact,
    impact_amount: input.impactAmount ?? null,
  }).value as RawAssessment);
}

export function buildEvidencePacket(input: GovernanceActionInput): EvidencePacket {
  return toPacket(runGovernanceCore("build_evidence_packet", {
    agent_name: input.agentName,
    queue: input.queue,
    action_description: input.actionDescription,
    financial_impact: input.financialImpact,
    impact_amount: input.impactAmount ?? null,
  }).value as RawEvidencePacket);
}
