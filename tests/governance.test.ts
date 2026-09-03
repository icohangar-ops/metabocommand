/**
 * Governance watchdog bridge tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessGovernanceAction,
  buildEvidencePacket,
  getAgentGovernanceProfile,
} from "../src/lib/governance-watchdog.ts";

test("governance bridge returns the expected profile", () => {
  const profile = getAgentGovernanceProfile("Sniper Agent");
  assert.equal(profile.agentName, "Sniper Agent");
  assert.equal(profile.autonomousLimit, 500);
  assert.equal(profile.trustLevel, "supervised");
});

test("governance bridge blocks irreversible external actions", () => {
  const assessment = assessGovernanceAction({
    agentName: "Pulse Agent",
    queue: "finance",
    actionDescription: "Execute payment to vendor",
    financialImpact: "$500",
    impactAmount: 500,
  });

  assert.equal(assessment.decision, "blocked");
  assert.ok(assessment.policyFlags.includes("irreversible_external_action"));
});

test("governance bridge builds evidence packets", () => {
  const packet = buildEvidencePacket({
    agentName: "Conductor Agent",
    queue: "finance",
    actionDescription: "Renegotiate vendor contract",
    financialImpact: "Potential $12,000 annual savings",
    impactAmount: 12000,
  });

  assert.match(packet.id, /^evp_finance_/);
  assert.equal(packet.actor.agent_name, "Conductor Agent");
  assert.equal(packet.watchdog.decision, "approval_required");
  assert.equal(packet.evidence_checklist.length, 5);
});
