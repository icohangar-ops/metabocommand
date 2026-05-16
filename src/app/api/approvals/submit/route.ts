import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";
import { buildEvidencePacket } from "@/lib/governance-watchdog";

const submitSchema = z.object({
  agent_name: z.string().min(1),
  queue: z.enum(["finance", "operations"]),
  action_description: z.string().min(1),
  financial_impact: z.string().min(1),
  impact_amount: z.number().nullable().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== parsed.data.queue) {
    return NextResponse.json({ error: "Role/queue mismatch" }, { status: 403 });
  }

  const evidencePacket = buildEvidencePacket({
    agentName: parsed.data.agent_name,
    queue: parsed.data.queue,
    actionDescription: parsed.data.action_description,
    financialImpact: parsed.data.financial_impact,
    impactAmount: parsed.data.impact_amount ?? null,
  });

  const { data: inserted, error: insertError } = await supabase
    .from("approval_items")
    .insert({
      agent_name: parsed.data.agent_name,
      queue: parsed.data.queue,
      action_description: parsed.data.action_description,
      financial_impact: parsed.data.financial_impact,
      impact_amount: parsed.data.impact_amount ?? null,
      status: "pending",
      agent_seniority: evidencePacket.actor.seniority,
      watchdog_decision: evidencePacket.watchdog.decision,
      policy_flags: evidencePacket.watchdog.policyFlags,
      evidence_packet_id: evidencePacket.id,
      evidence_packet: evidencePacket,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
  }

  // Slack notification (non-blocking for the user)
  const { data: slackSettings } = await supabase
    .from("slack_settings")
    .select("webhook_url, enabled")
    .eq("queue", parsed.data.queue)
    .single();

  if (slackSettings?.enabled && slackSettings.webhook_url) {
    const appUrl = new URL(request.url).origin;
    const slackResult = await sendSlackNotification(slackSettings.webhook_url, {
      queue: parsed.data.queue,
      agent_name: parsed.data.agent_name,
      action_description: parsed.data.action_description,
      financial_impact: parsed.data.financial_impact,
      approval_item_id: inserted.id,
      app_url: appUrl,
      event: "submitted",
    });
    if (slackResult.ok) {
      await supabase
        .from("approval_items")
        .update({ slack_notified: true })
        .eq("id", inserted.id);
    }
  }

  // Log to agent_action_log (as a proposal)
  await supabase.from("agent_action_log").insert({
    agent_name: parsed.data.agent_name,
    queue: parsed.data.queue,
    action_type: "Proposal Submitted",
    description: parsed.data.action_description,
    outcome: "Pending Approval",
    decided_by: "—",
    reasoning_summary: `Submitted from ${parsed.data.agent_name} view. Watchdog decision: ${evidencePacket.watchdog.decision}; flags: ${evidencePacket.watchdog.policyFlags.join(", ")}; evidence packet: ${evidencePacket.id}.`,
    approval_item_id: inserted.id,
    evidence_packet_id: evidencePacket.id,
    policy_flags: evidencePacket.watchdog.policyFlags,
  });

  return NextResponse.json({ id: inserted.id });
}
