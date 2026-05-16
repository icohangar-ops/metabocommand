import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";

const decideSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, email, role")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Fetch current item
  const { data: item } = await supabase
    .from("approval_items")
    .select("*")
    .eq("id", parsed.data.id)
    .eq("queue", profile.role)
    .single();

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.status !== "pending") {
    return NextResponse.json({ error: "Item already decided" }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from("approval_items")
    .update({
      status: parsed.data.decision,
      decided_at: new Date().toISOString(),
      decided_by: profile.id,
    })
    .eq("id", parsed.data.id)
    .eq("status", "pending");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Record activity history
  await supabase.from("activity_history").insert({
    user_id: profile.id,
    user_display_name: profile.display_name,
    user_email: profile.email,
    user_role: profile.role,
    activity_type: parsed.data.decision === "approved" ? "Approval — Approved" : "Approval — Rejected",
    description: `${parsed.data.decision === "approved" ? "Approved" : "Rejected"} ${item.agent_name} proposal: ${item.action_description}`,
    contextual_reference: item.id,
  });

  // Log to agent action log
  await supabase.from("agent_action_log").insert({
    agent_name: item.agent_name,
    queue: item.queue,
    action_type: "Decision",
    description: item.action_description,
    outcome: parsed.data.decision === "approved" ? "Approved" : "Rejected",
    decided_by: `${profile.display_name} (${profile.email})`,
    reasoning_summary: `Decision recorded by ${profile.display_name}${item.evidence_packet_id ? ` against evidence packet ${item.evidence_packet_id}` : ""}`,
    approval_item_id: item.id,
    evidence_packet_id: item.evidence_packet_id ?? null,
    policy_flags: item.policy_flags ?? [],
  });

  // Slack confirmation
  const { data: slackSettings } = await supabase
    .from("slack_settings")
    .select("webhook_url, enabled")
    .eq("queue", item.queue)
    .single();

  if (slackSettings?.enabled && slackSettings.webhook_url) {
    const appUrl = new URL(request.url).origin;
    await sendSlackNotification(slackSettings.webhook_url, {
      queue: item.queue,
      agent_name: item.agent_name,
      action_description: item.action_description,
      financial_impact: item.financial_impact,
      approval_item_id: item.id,
      app_url: appUrl,
      event: parsed.data.decision,
      decided_by: `${profile.display_name} (${profile.email})`,
    });
  }

  return NextResponse.json({ ok: true });
}
