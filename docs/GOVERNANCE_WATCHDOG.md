# Governance Watchdog

MetaboCommand now treats the approval queue as a runtime governance boundary, not only a task list.

## What Was Added

- Agent seniority profiles for all 12 agents: junior, professional, and senior professional.
- Watchdog policy flags for payment-affecting, customer-impacting, vendor/contract, pricing/spend, and irreversible external actions.
- Evidence packets attached to every new approval item.
- A role-scoped evidence export endpoint at `/api/approvals/evidence?id=<approval_id>`.
- Approval Queue UI details showing Watchdog decision, seniority, policy flags, evidence packet id, and checklist.
- Supabase migration `0004_governance_watchdog.sql` for governance fields and migrated seed evidence.

## Runtime Behavior

Every `/api/approvals/submit` request is evaluated before insertion:

1. The submitting user must still match the approval queue role.
2. The agent is mapped to a seniority and trust profile.
3. The action description and financial impact are scanned for high-impact policy flags.
4. An evidence packet is created with actor, intent, policy flags, approval boundary, checklist, and attribution.
5. The proposal remains pending until an authorized human decision is recorded.

The current demo still routes proposals through human approvals. The Watchdog layer makes the boundary explicit and exportable so future live integrations can fail closed before emails, customer messages, vendor changes, purchase orders, or finance actions execute.

## Attribution

Runtime enforcement, evidence-packet, and seniority-based decision-rights patterns are adapted from:

Georgios Fradelos, PhD, *Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees*, Geneva, January 9, 2026.

The implementation also aligns with the finance-grade evidence/audit direction reviewed from:

Georgios Fradelos, PhD, *Finance-Grade Assurance for Agentic AI: Verifiable Governance, Systemic Risk Mitigation, and Sustainability/Compute Accounting Architecture for Banks, Insurers, and Major Financial Services Providers*, Geneva, January 11, 2026.
