# Open Source Research Notes

MetaboCommand now includes explicit research attribution for adjacent
open-source projects reviewed during the strengthening pass. No upstream source
code is vendored in this repository.

## Customer Support And Human-In-The-Loop Agents

- [Tiledesk Dashboard](https://github.com/Tiledesk/tiledesk-dashboard) and
  [Tiledesk Server](https://github.com/Tiledesk/tiledesk-server)
  - Used as design references for human handoff, approval-oriented support
    flows, and operator-facing agent builder/dashboard patterns.
  - MetaboCommand implementation: Support Reflex now exposes evidence-gated
    escalation lanes that distinguish autonomous actions, approval-required
    actions, and human handoff.
- [intersystems-ib/customer-support-agent-demo](https://github.com/intersystems-ib/customer-support-agent-demo)
  - Used as a reference for SQL + RAG customer-support reasoning patterns.
  - MetaboCommand implementation: support lanes now name the evidence package
    that must be assembled before an agent can queue or execute a support
    action.
- [EpicStaff/EpicStaff](https://github.com/EpicStaff/EpicStaff)
  - Used as a visual workflow/orchestration comparison target.
  - MetaboCommand implementation: documentation positions MetaboCommand around
    commerce-specific replay, approvals, and role-scoped decisions rather than
    generic visual agent building.

## AI Governance References

- Georgios Fradelos, PhD, *Verifiable Governance Architecture (VGA) for
  Organisations and Teams with Human and AI Employees*, Geneva, January 9,
  2026.
  - Used for runtime Watchdog, evidence-packet, and seniority-based
    decision-rights patterns.
  - MetaboCommand implementation: `src/lib/governance-watchdog.ts`,
    `supabase/migrations/0004_governance_watchdog.sql`, and the Approval Queue
    display.
- Georgios Fradelos, PhD, *Finance-Grade Assurance for Agentic AI*, Geneva,
  January 11, 2026.
  - Used for finance-grade evidence/audit framing.
  - MetaboCommand implementation: evidence packets bind actor, intent,
    policy flags, approval boundary, and decision trail before execution.

## Attribution And Reuse Rules

- Preserve upstream license and copyright notices if any code is copied in the
  future.
- Prefer adapters, docs, and implementation patterns over vendoring code.
- If a dependency is added, pin the package/version and update this file.
- If upstream code is vendored, include the source repo, license, and commit
  SHA in this document.
