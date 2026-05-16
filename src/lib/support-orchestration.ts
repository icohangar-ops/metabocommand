export type SupportEscalationMode = "autonomous" | "approval_required" | "human_handoff";

export interface SupportEscalationLane {
  id: string;
  lane: string;
  mode: SupportEscalationMode;
  guardrail: string;
  evidence: string[];
  approvalTrigger: string;
  projectedImpact: string;
  owner: string;
}

export const supportEscalationLanes: SupportEscalationLane[] = [
  {
    id: "returns-low-value",
    lane: "Low-value returns",
    mode: "autonomous",
    guardrail: "Order value <= $35, no fraud flag, no repeat-abuse marker, product not final-sale.",
    evidence: ["Order history", "Return policy match", "Fraud/risk flags", "Customer lifetime segment"],
    approvalTrigger: "Policy drift or refund exposure above $2,500/day.",
    projectedImpact: "44% of return inquiries resolved in under 2 hours.",
    owner: "Support Reflex Agent",
  },
  {
    id: "shipping-delay-credit",
    lane: "Shipping delay credits",
    mode: "approval_required",
    guardrail: "Carrier delay confirmed by Logistics Conductor and customer notified before credit.",
    evidence: ["Tracking event", "Carrier SLA", "Customer tier", "Prior concession history"],
    approvalTrigger: "Any proactive credit above 20% order value or VIP customer override.",
    projectedImpact: "Reduces WISMO escalations by 31% during promo weeks.",
    owner: "Support Reflex Agent + Logistics Conductor",
  },
  {
    id: "product-defect-cluster",
    lane: "Defect cluster triage",
    mode: "human_handoff",
    guardrail: "Three-source evidence required before product-page or packaging changes.",
    evidence: ["Ticket cluster", "Review sentiment", "Return reason codes", "SKU margin impact"],
    approvalTrigger: "Always requires operations lead approval before external copy changes.",
    projectedImpact: "Deflects 60% of SKU-0091 pairing tickets after content update.",
    owner: "Support Reflex Agent + Harmony Agent",
  },
];

export function summarizeSupportEscalation(lanes: SupportEscalationLane[]) {
  return lanes.reduce(
    (summary, lane) => {
      summary.total += 1;
      summary.evidenceChecks += lane.evidence.length;
      if (lane.mode === "autonomous") summary.autonomous += 1;
      if (lane.mode === "approval_required") summary.approvalRequired += 1;
      if (lane.mode === "human_handoff") summary.humanHandoff += 1;
      return summary;
    },
    {
      total: 0,
      autonomous: 0,
      approvalRequired: 0,
      humanHandoff: 0,
      evidenceChecks: 0,
    }
  );
}

export function escalationModeLabel(mode: SupportEscalationMode) {
  if (mode === "autonomous") return "Autonomous";
  if (mode === "approval_required") return "Approval Required";
  return "Human Handoff";
}
