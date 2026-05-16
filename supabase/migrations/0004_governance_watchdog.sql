-- Phase 2c: Governance Watchdog, seniority permissions, and evidence packets
-- Run in Supabase Dashboard -> SQL Editor AFTER 0001, 0002, and 0003

do $$
begin
  create type agent_seniority as enum ('junior', 'professional', 'senior_professional');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type watchdog_decision as enum ('pass', 'approval_required', 'blocked');
exception
  when duplicate_object then null;
end $$;

alter table public.agents
  add column if not exists seniority agent_seniority not null default 'junior';

alter table public.approval_items
  add column if not exists agent_seniority agent_seniority not null default 'junior',
  add column if not exists watchdog_decision watchdog_decision not null default 'approval_required',
  add column if not exists policy_flags jsonb not null default '[]'::jsonb,
  add column if not exists evidence_packet_id text not null default ('evp_' || replace(gen_random_uuid()::text, '-', '')),
  add column if not exists evidence_packet jsonb not null default '{}'::jsonb;

alter table public.agent_action_log
  add column if not exists evidence_packet_id text,
  add column if not exists policy_flags jsonb not null default '[]'::jsonb;

create index if not exists approval_items_watchdog_idx
  on public.approval_items(queue, watchdog_decision, submitted_at desc);

create index if not exists approval_items_evidence_packet_idx
  on public.approval_items(evidence_packet_id);

update public.agents
set seniority = case name
  when 'Conductor Agent' then 'senior_professional'::agent_seniority
  when 'Harmony Agent' then 'senior_professional'::agent_seniority
  when 'Advocacy Agent' then 'junior'::agent_seniority
  else 'professional'::agent_seniority
end;

update public.approval_items item
set
  agent_seniority = coalesce(agent.seniority, item.agent_seniority),
  watchdog_decision = 'approval_required'::watchdog_decision,
  policy_flags = case
    when item.policy_flags = '[]'::jsonb then '["seeded_prior_approval", "human_decision_required"]'::jsonb
    else item.policy_flags
  end,
  evidence_packet = case
    when item.evidence_packet = '{}'::jsonb then jsonb_build_object(
      'id', item.evidence_packet_id,
      'created_at', item.submitted_at,
      'actor', jsonb_build_object(
        'agent_name', item.agent_name,
        'queue', item.queue,
        'seniority', coalesce(agent.seniority::text, item.agent_seniority::text)
      ),
      'intent', jsonb_build_object(
        'action_description', item.action_description,
        'financial_impact', item.financial_impact,
        'impact_amount', item.impact_amount
      ),
      'watchdog', jsonb_build_object(
        'decision', 'approval_required',
        'policy_flags', jsonb_build_array('seeded_prior_approval', 'human_decision_required')
      ),
      'evidence_checklist', jsonb_build_array(
        jsonb_build_object('label', 'Historical proposal migrated into governance trail', 'status', 'present'),
        jsonb_build_object('label', 'Human approval required before external execution', 'status', 'required')
      ),
      'attribution', 'Runtime enforcement, evidence-packet, and seniority-rights patterns adapted from Georgios Fradelos, PhD, Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees, Geneva, January 9, 2026.'
    )
    else item.evidence_packet
  end
from public.agents agent
where agent.name = item.agent_name;

comment on column public.approval_items.evidence_packet is
  'Evidence-packet governance pattern adapted from Georgios Fradelos, PhD, Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees, Geneva, January 9, 2026.';

comment on column public.agents.seniority is
  'Agent seniority and decision-rights pattern adapted from Georgios Fradelos, PhD, Verifiable Governance Architecture (VGA) for Organisations and Teams with Human and AI Employees, Geneva, January 9, 2026.';
