import { createClient } from "@supabase/supabase-js";
import { buildEvidencePacket } from "../src/lib/governance-watchdog.ts";
import { sendSlackNotification } from "../src/lib/slack.ts";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type ToolHandler = (args: Record<string, unknown>) => Promise<JsonValue> | JsonValue;

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const TOOLS: ToolSpec[] = [
  {
    name: "mission_board",
    description: "Inspect the current approval queues, logs, and skills.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => missionBoard(),
  },
  {
    name: "submit_approval",
    description: "Submit a new approval request into the queue.",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string" },
        queue: { type: "string", enum: ["finance", "operations"] },
        action_description: { type: "string" },
        financial_impact: { type: "string" },
        impact_amount: { type: ["number", "null"] },
      },
      required: ["agent_name", "queue", "action_description", "financial_impact"],
    },
    handler: async (args) => submitApproval(args),
  },
  {
    name: "decide_approval",
    description: "Approve or reject an approval request.",
    inputSchema: {
      type: "object",
      properties: {
        approval_id: { type: "string" },
        decision: { type: "string", enum: ["approved", "rejected"] },
        decided_by: { type: "string" },
        decision_note: { type: "string" },
      },
      required: ["approval_id", "decision", "decided_by"],
    },
    handler: async (args) => decideApproval(args),
  },
  {
    name: "get_evidence",
    description: "Fetch the evidence packet for an approval request.",
    inputSchema: {
      type: "object",
      properties: { approval_id: { type: "string" } },
      required: ["approval_id"],
    },
    handler: async (args) => getEvidence(args),
  },
  {
    name: "update_agent_threshold",
    description: "Update an agent's autonomous limit and approval threshold.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        autonomous_limit: { type: ["number", "null"] },
        approval_required_above: { type: ["number", "null"] },
      },
      required: ["agent_id"],
    },
    handler: async (args) => updateAgentThreshold(args),
  },
  {
    name: "set_operating_mode",
    description: "Switch the operating mode between growth and efficiency.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["growth", "efficiency"] } },
      required: ["mode"],
    },
    handler: async (args) => setOperatingMode(args),
  },
];

async function main() {
  const server = new StdioServer("metabocommand", "0.1.0", TOOLS);
  await server.serve();
}

class StdioServer {
  private readonly tools: Map<string, ToolSpec>;

  constructor(
    private readonly name: string,
    private readonly version: string,
    tools: ToolSpec[],
  ) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async serve() {
    for await (const message of readMessages()) {
      if (message.method === "initialize") {
        respond(message, {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          serverInfo: { name: this.name, version: this.version },
          capabilities: { tools: { listChanged: false } },
        });
        continue;
      }
      if (message.method === "tools/list") {
        respond(message, { tools: [...this.tools.values()].map((tool) => toolEntry(tool)) });
        continue;
      }
      if (message.method === "tools/call") {
        const tool = this.tools.get(String(message.params?.name ?? ""));
        if (!tool) {
          respondError(message, -32602, `unknown tool: ${String(message.params?.name ?? "")}`);
          continue;
        }
        try {
          const result = await tool.handler((message.params?.arguments as Record<string, unknown>) ?? {});
          respond(message, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (error) {
          respondError(message, -32000, error instanceof Error ? error.message : "tool failed");
        }
        continue;
      }
      if (message.method === "shutdown") {
        respond(message, {});
        return;
      }
    }
  }
}

function toolEntry(tool: ToolSpec) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

async function submitApproval(args: Record<string, unknown>) {
  const agentName = requiredString(args.agent_name, "agent_name");
  const queue = requiredQueue(args.queue);
  const actionDescription = requiredString(args.action_description, "action_description");
  const financialImpact = requiredString(args.financial_impact, "financial_impact");
  const impactAmount = typeof args.impact_amount === "number" ? args.impact_amount : null;
  const evidencePacket = buildEvidencePacket({
    agentName,
    queue,
    actionDescription,
    financialImpact,
    impactAmount,
  });

  const { data: inserted, error } = await supabase
    .from("approval_items")
    .insert({
      agent_name: agentName,
      queue,
      action_description: actionDescription,
      financial_impact: financialImpact,
      impact_amount: impactAmount,
      status: "pending",
      agent_seniority: evidencePacket.actor.seniority,
      watchdog_decision: evidencePacket.watchdog.decision,
      policy_flags: evidencePacket.watchdog.policyFlags,
      evidence_packet_id: evidencePacket.id,
      evidence_packet: evidencePacket,
      slack_notified: false,
    })
    .select()
    .single();
  if (error || !inserted) {
    throw new Error(error?.message ?? "approval insert failed");
  }

  await supabase.from("agent_action_log").insert({
    agent_name: agentName,
    queue,
    action_type: "Proposal Submitted",
    description: actionDescription,
    outcome: "Pending Approval",
    decided_by: "MCP",
    reasoning_summary: `Submitted by MCP bridge; watchdog decision ${evidencePacket.watchdog.decision}`,
    approval_item_id: inserted.id,
    evidence_packet_id: evidencePacket.id,
    policy_flags: evidencePacket.watchdog.policyFlags,
  });

  await maybeSendSlack(queue, agentName, actionDescription, financialImpact, inserted.id, "submitted");

  return { approval_id: inserted.id, evidence_packet_id: evidencePacket.id };
}

async function decideApproval(args: Record<string, unknown>) {
  const approvalId = requiredString(args.approval_id, "approval_id");
  const decision = requiredDecision(args.decision);
  const decidedBy = requiredString(args.decided_by, "decided_by");
  const decisionNote = typeof args.decision_note === "string" ? args.decision_note : "";

  const { data: item, error } = await supabase.from("approval_items").select("*").eq("id", approvalId).single();
  if (error || !item) {
    throw new Error(error?.message ?? "approval item not found");
  }
  if (item.status !== "pending") {
    throw new Error("item already decided");
  }

  const status = decision === "approved" ? "approved" : "rejected";
  const { error: updateError } = await supabase
    .from("approval_items")
    .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq("id", approvalId)
    .eq("status", "pending");
  if (updateError) {
    throw new Error(updateError.message);
  }

  await supabase.from("activity_history").insert({
    user_id: null,
    user_display_name: decidedBy,
    user_email: "",
    user_role: item.queue,
    activity_type: decision === "approved" ? "Approval - Approved" : "Approval - Rejected",
    description: `${decision === "approved" ? "Approved" : "Rejected"} ${item.agent_name} proposal: ${item.action_description}`,
    contextual_reference: item.id,
  });

  await supabase.from("agent_action_log").insert({
    agent_name: item.agent_name,
    queue: item.queue,
    action_type: "Decision",
    description: item.action_description,
    outcome: decision === "approved" ? "Approved" : "Rejected",
    decided_by: decidedBy,
    reasoning_summary: decisionNote || `Decision recorded by ${decidedBy}`,
    approval_item_id: item.id,
    evidence_packet_id: item.evidence_packet_id ?? null,
    policy_flags: item.policy_flags ?? [],
  });

  await maybeSendSlack(item.queue, item.agent_name, item.action_description, item.financial_impact, item.id, decision, decidedBy);

  return { approval_id: item.id, status };
}

async function getEvidence(args: Record<string, unknown>) {
  const approvalId = requiredString(args.approval_id, "approval_id");
  const { data, error } = await supabase
    .from("approval_items")
    .select("id, queue, evidence_packet_id, evidence_packet, watchdog_decision, policy_flags")
    .eq("id", approvalId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "evidence not found");
  }
  return data;
}

async function updateAgentThreshold(args: Record<string, unknown>) {
  const agentId = requiredString(args.agent_id, "agent_id");
  const autonomousLimit = normalizeNullableNumber(args.autonomous_limit);
  const approvalRequiredAbove = normalizeNullableNumber(args.approval_required_above);
  const { data, error } = await supabase
    .from("agents")
    .update({ autonomous_limit: autonomousLimit, approval_required_above: approvalRequiredAbove })
    .eq("id", agentId)
    .select("id, name, queue, autonomous_limit, approval_required_above")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "agent not found");
  }
  return data;
}

async function setOperatingMode(args: Record<string, unknown>) {
  const mode = requiredOperatingMode(args.mode);
  const { data: current } = await supabase.from("app_settings").select("value").eq("key", "operating_mode").single();
  const previous = (current?.value as string | undefined) ?? "efficiency";
  const { error } = await supabase
    .from("app_settings")
    .update({ value: mode, updated_at: new Date().toISOString(), updated_by: null })
    .eq("key", "operating_mode");
  if (error) {
    throw new Error(error.message);
  }
  await supabase.from("agent_action_log").insert({
    agent_name: "Harmony Agent",
    queue: "operations",
    action_type: "Mode Change Logged",
    description: `Operating mode switched from ${previous} to ${mode}`,
    outcome: "Logged",
    decided_by: "MCP",
    reasoning_summary: "Mode change confirmed via MCP bridge",
  });
  return { ok: true, mode, previous_mode: previous };
}

async function maybeSendSlack(
  queue: "finance" | "operations",
  agentName: string,
  actionDescription: string,
  financialImpact: string,
  approvalItemId: string,
  event: "submitted" | "approved" | "rejected",
  decidedBy?: string,
) {
  const { data: slackSettings } = await supabase.from("slack_settings").select("webhook_url, enabled").eq("queue", queue).single();
  if (!slackSettings?.enabled || !slackSettings.webhook_url) {
    return;
  }
  await sendSlackNotification(slackSettings.webhook_url as string, {
    queue,
    agent_name: agentName,
    action_description: actionDescription,
    financial_impact: financialImpact,
    approval_item_id: approvalItemId,
    app_url: process.env.APP_URL ?? "http://localhost:3000",
    event,
    decided_by: decidedBy,
  });
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing environment variable: ${name}`);
  }
  return value;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function requiredQueue(value: unknown): "finance" | "operations" {
  if (value === "finance" || value === "operations") {
    return value;
  }
  throw new Error("queue must be finance or operations");
}

function requiredDecision(value: unknown): "approved" | "rejected" {
  if (value === "approved" || value === "rejected") {
    return value;
  }
  throw new Error("decision must be approved or rejected");
}

function requiredOperatingMode(value: unknown): "growth" | "efficiency" {
  if (value === "growth" || value === "efficiency") {
    return value;
  }
  throw new Error("mode must be growth or efficiency");
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error("threshold values must be numbers or null");
  }
  return value;
}

async function missionBoard() {
  const [departments, agents, approvals, workflows, actions, evidencePackets, alerts, skills] = await Promise.all([
    supabase.from("departments").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("agents").select("*").order("name", { ascending: true }).limit(100),
    supabase.from("approval_items").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(50),
    supabase.from("workflows").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("agent_action_log").select("*").order("timestamp", { ascending: false }).limit(50),
    supabase.from("evidence_packets").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("security_events").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("skills").select("*").order("name", { ascending: true }).limit(100),
  ]);

  return {
    departments: departments.data ?? [],
    agents: agents.data ?? [],
    approval_inbox: approvals.data ?? [],
    task_queue: workflows.data ?? [],
    agent_action_log: actions.data ?? [],
    evidence_packets: evidencePackets.data ?? [],
    alert_feed: alerts.data ?? [],
    skill_registry: skills.data ?? [],
  };
}

type Message = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
};

async function* readMessages(): AsyncGenerator<Message> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }
      const headerText = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        throw new Error("missing Content-Length header");
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) {
        break;
      }
      const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      yield JSON.parse(body) as Message;
      buffer = buffer.slice(bodyStart + length);
    }
  }
}

function respond(message: Message, result: JsonValue) {
  const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function respondError(message: Message, code: number, detail: string) {
  const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code, message: detail } }), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
