"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PresenceBar } from "./presence-bar";
import { formatDateTime } from "@/lib/utils";
import type { AgentSeniority, ApprovalItem, UserRole, WatchdogDecision } from "@/lib/supabase/types";

type ActivityStatus = "idle" | "reviewing" | "approving" | "rejecting";

interface PresenceState {
  user_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  activity_status: ActivityStatus;
  online_at: string;
}

interface ApprovalQueueProps {
  initialItems: ApprovalItem[];
  role: UserRole;
  currentUser: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
  };
}

const IDLE_TIMEOUT_MS = 60_000;

const seniorityLabels: Record<AgentSeniority, string> = {
  junior: "Junior",
  professional: "Professional",
  senior_professional: "Senior Professional",
};

const watchdogLabels: Record<WatchdogDecision, string> = {
  pass: "Pass",
  approval_required: "Approval Required",
  blocked: "Blocked",
};

const watchdogClasses: Record<WatchdogDecision, string> = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approval_required: "bg-amber-50 text-amber-800 border-amber-200",
  blocked: "bg-rose-50 text-rose-800 border-rose-200",
};

function evidenceChecklist(item: ApprovalItem) {
  const packet = item.evidence_packet as
    | { evidence_checklist?: Array<{ label: string; status: string }> }
    | null
    | undefined;
  return packet?.evidence_checklist ?? [];
}

export function ApprovalQueue({ initialItems, role, currentUser }: ApprovalQueueProps) {
  const [items, setItems] = useState<ApprovalItem[]>(initialItems);
  const [presenceState, setPresenceState] = useState<Record<string, PresenceState>>({});
  const [myStatus, setMyStatus] = useState<ActivityStatus>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const queueChannelName = `approval-queue-${role}`;
  const tableChannelName = `approval-table-${role}`;

  // Realtime subscription on approval_items
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(tableChannelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "approval_items",
          filter: `queue=eq.${role}`,
        },
        (payload) => {
          const newItem = payload.new as ApprovalItem;
          setItems((prev) => {
            if (prev.find((i) => i.id === newItem.id)) return prev;
            return [newItem, ...prev];
          });
          showToast(`New approval item: ${newItem.agent_name}`);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "approval_items",
          filter: `queue=eq.${role}`,
        },
        (payload) => {
          const updated = payload.new as ApprovalItem;
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
          if (updated.status !== "pending") {
            showToast(`Item ${updated.status}: ${updated.agent_name}`);
          }
        }
      )
      .subscribe((status) => {
        setConnectionLost(status !== "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, tableChannelName]);

  // Presence channel
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(queueChannelName, {
      config: { presence: { key: currentUser.id } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();
        const flat: Record<string, PresenceState> = {};
        for (const key of Object.keys(state)) {
          const entries = state[key];
          if (entries && entries.length > 0) {
            flat[key] = entries[0];
          }
        }
        setPresenceState(flat);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: currentUser.id,
            display_name: currentUser.displayName,
            email: currentUser.email,
            avatar_url: currentUser.avatarUrl,
            activity_status: "idle",
            online_at: new Date().toISOString(),
          } satisfies PresenceState);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [queueChannelName, currentUser.id, currentUser.displayName, currentUser.email, currentUser.avatarUrl]);

  // Broadcast activity status changes
  async function updateActivityStatus(next: ActivityStatus) {
    setMyStatus(next);
    const channel = channelRef.current;
    if (!channel) return;
    await channel.track({
      user_id: currentUser.id,
      display_name: currentUser.displayName,
      email: currentUser.email,
      avatar_url: currentUser.avatarUrl,
      activity_status: next,
      online_at: new Date().toISOString(),
    } satisfies PresenceState);
  }

  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      updateActivityStatus("idle");
    }, IDLE_TIMEOUT_MS);
  }

  useEffect(() => {
    if (myStatus !== "idle") {
      resetIdleTimer();
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [myStatus]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleDecide(id: string, decision: "approved" | "rejected") {
    setDecidingId(id);
    await updateActivityStatus(decision === "approved" ? "approving" : "rejecting");
    try {
      const res = await fetch("/api/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(`Error: ${body.error ?? res.statusText}`);
      }
    } catch {
      showToast("Network error");
    } finally {
      setDecidingId(null);
      await updateActivityStatus("idle");
    }
  }

  function handleHoverItem() {
    if (myStatus === "idle") updateActivityStatus("reviewing");
  }

  const pendingCount = useMemo(
    () => items.filter((i) => i.status === "pending").length,
    [items]
  );

  const presenceList = Object.values(presenceState);

  return (
    <div className="space-y-5">
      <PresenceBar presences={presenceList} currentUserId={currentUser.id} />

      {connectionLost && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Reconnecting to live updates…
        </div>
      )}

      {toast && (
        <div className="fixed top-6 right-6 z-50 rounded-md bg-slate-900 text-white text-sm px-4 py-3 shadow-lg">
          {toast}
        </div>
      )}

      <div className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">{pendingCount}</span> pending ·{" "}
        <span className="font-medium text-slate-900">{items.length}</span> total
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <Card
            key={item.id}
            id={item.id}
            onMouseEnter={handleHoverItem}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {item.agent_name}
                    </span>
                    <Badge variant={item.status}>
                      {item.status === "pending"
                        ? "Pending"
                        : item.status === "approved"
                        ? "Approved"
                        : "Rejected"}
                    </Badge>
                    {item.slack_notified && (
                      <span className="text-xs text-slate-500">· Slack sent</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 mt-2">
                    {item.action_description}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                    <span>Impact: <span className="font-medium text-slate-700">{item.financial_impact}</span></span>
                    <span>· Submitted {formatDateTime(item.submitted_at)}</span>
                  </div>
                  {item.watchdog_decision && (
                    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full border px-2 py-1 font-semibold ${watchdogClasses[item.watchdog_decision]}`}
                        >
                          Watchdog: {watchdogLabels[item.watchdog_decision]}
                        </span>
                        {item.agent_seniority && (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700">
                            Seniority: {seniorityLabels[item.agent_seniority]}
                          </span>
                        )}
                        {item.evidence_packet_id && (
                          <a
                            href={`/api/approvals/evidence?id=${item.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-600 hover:text-slate-900"
                          >
                            {item.evidence_packet_id}
                          </a>
                        )}
                      </div>
                      {item.policy_flags && item.policy_flags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.policy_flags.map((flag) => (
                            <span
                              key={flag}
                              className="rounded bg-white px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200"
                            >
                              {flag.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      {evidenceChecklist(item).length > 0 && (
                        <details className="mt-3 text-xs text-slate-600">
                          <summary className="cursor-pointer font-medium text-slate-700">
                            Evidence checklist
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {evidenceChecklist(item).map((check) => (
                              <li key={`${item.id}-${check.label}`} className="flex items-center justify-between gap-3">
                                <span>{check.label}</span>
                                <span className="font-medium text-slate-500">{check.status.replaceAll("_", " ")}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="success"
                    disabled={item.status !== "pending" || decidingId === item.id}
                    onClick={() => handleDecide(item.id, "approved")}
                  >
                    {decidingId === item.id && myStatus === "approving" ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={item.status !== "pending" || decidingId === item.id}
                    onClick={() => handleDecide(item.id, "rejected")}
                  >
                    {decidingId === item.id && myStatus === "rejecting" ? "Rejecting…" : "Reject"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
