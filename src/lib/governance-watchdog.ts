import type { ApprovalQueueName } from "@/lib/supabase/types";

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

const DEFAULT_PROFILE: AgentGovernanceProfile = {
  agentName: "Unknown Agent",
  seniority: "junior",
  trustLevel: "approval_required",
  autonomousLimit: 0,
  approvalRequiredAbove: 0,
  decisionRights: ["Draft proposal", "Assemble evidence", "Queue approval"],
};

const AGENT_PROFILES: Record<string, AgentGovernanceProfile> = {
  "Pulse Agent": {
    agentName: "Pulse Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Detect anomalies", "Recommend capital actions", "Queue approval"],
  },
  "Oracle Agent": {
    agentName: "Oracle Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Model scenarios", "Rank forecast paths", "Queue approval"],
  },
  "Sniper Agent": {
    agentName: "Sniper Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 500,
    approvalRequiredAbove: 500,
    decisionRights: ["Identify waste", "Auto-close low-risk spend", "Queue higher-risk actions"],
  },
  "Conductor Agent": {
    agentName: "Conductor Agent",
    seniority: "senior_professional",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Coordinate capital flows", "Resolve finance conflicts", "Queue approval"],
  },
  "Acquisition Agent": {
    agentName: "Acquisition Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 500,
    approvalRequiredAbove: 500,
    decisionRights: ["Optimize acquisition spend", "Pause low-risk campaigns", "Queue approval"],
  },
  "Conversion Agent": {
    agentName: "Conversion Agent",
    seniority: "professional",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Analyze tests", "Recommend rollout", "Queue approval"],
  },
  "Retention Agent": {
    agentName: "Retention Agent",
    seniority: "professional",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Segment churn risk", "Draft campaigns", "Queue approval"],
  },
  "Demand Prophet Agent": {
    agentName: "Demand Prophet Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 10_000,
    approvalRequiredAbove: 10_000,
    decisionRights: ["Forecast demand", "Auto-issue low-risk replenishment", "Queue approval"],
  },
  "Logistics Conductor Agent": {
    agentName: "Logistics Conductor Agent",
    seniority: "professional",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Compare carriers", "Recommend route changes", "Queue approval"],
  },
  "Support Reflex Agent": {
    agentName: "Support Reflex Agent",
    seniority: "professional",
    trustLevel: "supervised",
    autonomousLimit: 35,
    approvalRequiredAbove: 35,
    decisionRights: ["Resolve low-value returns", "Draft credits", "Escalate human handoff"],
  },
  "Advocacy Agent": {
    agentName: "Advocacy Agent",
    seniority: "junior",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Identify advocates", "Draft outreach", "Queue approval"],
  },
  "Harmony Agent": {
    agentName: "Harmony Agent",
    seniority: "senior_professional",
    trustLevel: "approval_required",
    autonomousLimit: 0,
    approvalRequiredAbove: 0,
    decisionRights: ["Coordinate agents", "Detect conflicts", "Queue approval"],
  },
};

const POLICY_RULES = [
  {
    id: "payment_affecting",
    pattern: /\b(payment|pay|purchase|po|refund|credit|capital commitment|pre-purchase)\b/i,
  },
  {
    id: "customer_impacting",
    pattern: /\b(customer|campaign|win-back|discount|checkout|rollout|returns|review request)\b/i,
  },
  {
    id: "vendor_or_contract_change",
    pattern: /\b(vendor|carrier|contract|renegotiate|salesforce|supplier)\b/i,
  },
  {
    id: "pricing_or_spend_change",
    pattern: /\b(price|pricing|spend|ads|reallocate|cancel|pause|subscription)\b/i,
  },
  {
    id: "irreversible_external_action",
    pattern: /\b(sign contract|wire|ach|send money|execute payment|delete customer|terminate account)\b/i,
  },
];

function moneyValuesFromText(text: string) {
  const matches = [...text.matchAll(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g)];
  return matches.map((match) => Number(match[1].replaceAll(",", ""))).filter(Number.isFinite);
}

function maxObservedAmount(input: GovernanceActionInput) {
  const explicit = typeof input.impactAmount === "number" ? Math.abs(input.impactAmount) : 0;
  const inferred = moneyValuesFromText(`${input.actionDescription} ${input.financialImpact}`);
  return Math.max(explicit, ...inferred, 0);
}

function packetId(input: GovernanceActionInput) {
  const slug = input.agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `evp_${input.queue}_${slug}_${Date.now().toString(36)}`;
}

export function getAgentGovernanceProfile(agentName: string): AgentGovernanceProfile {
  return AGENT_PROFILES[agentName] ?? { ...DEFAULT_PROFILE, agentName };
}

export function assessGovernanceAction(input: GovernanceActionInput): WatchdogAssessment {
  const profile = getAgentGovernanceProfile(input.agentName);
  const inspectedText = `${input.actionDescription} ${input.financialImpact}`;
  const policyFlags = POLICY_RULES.filter((rule) => rule.pattern.test(inspectedText)).map((rule) => rule.id);
  const observedAmount = maxObservedAmount(input);
  const crossesLimit = observedAmount > profile.autonomousLimit;
  const requiresApproval = policyFlags.length > 0 || profile.trustLevel === "approval_required" || crossesLimit;
  const decision: WatchdogDecision = policyFlags.includes("irreversible_external_action")
    ? "blocked"
    : requiresApproval
      ? "approval_required"
      : "pass";

  const requiredApprovals = new Set<string>();
  if (input.queue === "finance") requiredApprovals.add("CFO");
  if (input.queue === "operations") requiredApprovals.add("Operations Lead");
  if (policyFlags.includes("payment_affecting")) requiredApprovals.add("Finance Owner");
  if (policyFlags.includes("customer_impacting")) requiredApprovals.add("Customer/Operations Owner");
  if (policyFlags.includes("vendor_or_contract_change")) requiredApprovals.add("Vendor/Legal Owner");

  return {
    decision,
    seniority: profile.seniority,
    trustLevel: profile.trustLevel,
    policyFlags: policyFlags.length > 0 ? policyFlags : ["no_high_impact_flag_detected"],
    requiredApprovals: [...requiredApprovals],
    autonomousLimit: profile.autonomousLimit,
    maximumObservedAmount: observedAmount,
  };
}

export function buildEvidencePacket(input: GovernanceActionInput): EvidencePacket {
  const assessment = assessGovernanceAction(input);
  const profile = getAgentGovernanceProfile(input.agentName);

  return {
    id: packetId(input),
    created_at: new Date().toISOString(),
    actor: {
      agent_name: input.agentName,
      queue: input.queue,
      seniority: profile.seniority,
      trust_level: profile.trustLevel,
    },
    intent: {
      action_description: input.actionDescription,
      financial_impact: input.financialImpact,
      impact_amount: input.impactAmount ?? null,
    },
    watchdog: assessment,
    evidence_checklist: [
      { label: "Agent identity and queue role verified", status: "present" },
      { label: "Business intent captured before tool execution", status: "present" },
      { label: "Financial/customer/vendor impact classified", status: "present" },
      { label: "Human approval recorded before external execution", status: "required" },
      { label: "Rollback or reversal path documented by owner", status: "required" },
    ],
    source_commitments: [
      "Approval item payload",
      "Role-scoped Supabase profile",
      "Agent seniority profile",
      "MetaboCommand Watchdog policy bundle",
    ],
    approval_boundary:
      assessment.decision === "pass"
        ? "Action may remain autonomous within the configured limit."
        : "Action must stay in the approval queue until an authorized human decision is recorded.",
    attribution:
      "Runtime enforcement, evidence-packet, and seniority-rights patterns adapted from Georgios Fradelos, PhD, Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees, Geneva, January 9, 2026.",
  };
}
