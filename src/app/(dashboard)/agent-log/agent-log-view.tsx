"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckboxList } from "@/components/ui/checkbox-list";
import { Button } from "@/components/ui/button";
import { LogPresenceBar, type LogActivityStatus } from "./log-presence-bar";
import { formatDateTime, cn } from "@/lib/utils";
import type { AgentActionLogEntry, UserRole } from "@/lib/supabase/types";

const IDLE_TIMEOUT_MS = 60_000;
const FILTER_IDLE_MS = 5_000;

interface LogPresenceState {
  user_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  activity_status: LogActivityStatus;
  online_at: string;
}

interface AgentLogViewProps {
  initialRecords: AgentActionLogEntry[];
  role: UserRole;
  currentUser: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
  };
}

export function AgentLogView({ initialRecords, role, currentUser }: AgentLogViewProps) {
  const [records, setRecords] = useState<AgentActionLogEntry[]>(initialRecords);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Filters
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedActionTypes, setSelectedActionTypes] = useState<Set<string>>(new Set());
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Presence
  const [presenceState, setPresenceState] = useState<Record<string, LogPresenceState>>({});
  const [myStatus, setMyStatus] = useState<LogActivityStatus>("idle");
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const filterIdleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const presenceChannelName = `agent-log-${role}`;
  const tableChannelName = `agent-log-table-${role}`;

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Realtime on agent_action_log
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(tableChannelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_action_log",
          filter: `queue=eq.${role}`,
        },
        (payload) => {
          const row = payload.new as AgentActionLogEntry;
          setRecords((prev) => {
            if (prev.find((r) => r.id === row.id)) return prev;
            return [row, ...prev];
          });
          setHighlightIds((prev) => new Set(prev).add(row.id));
          setTimeout(() => {
            setHighlightIds((prev) => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
          }, 2500);
          showToast(`New log: ${row.agent_name} — ${row.action_type}`);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agent_action_log",
          filter: `queue=eq.${role}`,
        },
        (payload) => {
          const row = payload.new as AgentActionLogEntry;
          setRecords((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, tableChannelName, showToast]);

  // Presence
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(presenceChannelName, {
      config: { presence: { key: currentUser.id } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<LogPresenceState>();
        const flat: Record<string, LogPresenceState> = {};
        for (const key of Object.keys(state)) {
          const entries = state[key];
          if (entries && entries.length > 0) flat[key] = entries[0];
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
          } satisfies LogPresenceState);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [presenceChannelName, currentUser.id, currentUser.displayName, currentUser.email, currentUser.avatarUrl]);

  async function updateActivityStatus(next: LogActivityStatus) {
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
    } satisfies LogPresenceState);
  }

  // Idle timer (generic)
  useEffect(() => {
    if (myStatus === "idle") return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => updateActivityStatus("idle"), IDLE_TIMEOUT_MS);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [myStatus]);

  function onRowExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
    if (expandedId === id) {
      updateActivityStatus("idle");
    } else {
      updateActivityStatus("reviewing");
    }
  }

  function onFilterInteraction() {
    updateActivityStatus("filtering");
    if (filterIdleTimerRef.current) clearTimeout(filterIdleTimerRef.current);
    filterIdleTimerRef.current = setTimeout(() => {
      if (myStatus === "filtering") updateActivityStatus("idle");
    }, FILTER_IDLE_MS);
  }

  function clearFilters() {
    setSelectedAgents(new Set());
    setSelectedActionTypes(new Set());
    setSelectedOutcomes(new Set());
    setDateFrom("");
    setDateTo("");
    onFilterInteraction();
  }

  // Derive filter options from the full record set
  const filterOptions = useMemo(() => {
    const agents = new Set<string>();
    const actionTypes = new Set<string>();
    const outcomes = new Set<string>();
    for (const r of records) {
      agents.add(r.agent_name);
      actionTypes.add(r.action_type);
      outcomes.add(r.outcome);
    }
    return {
      agents: Array.from(agents).sort(),
      actionTypes: Array.from(actionTypes).sort(),
      outcomes: Array.from(outcomes).sort(),
    };
  }, [records]);

  // Apply filters
  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (selectedAgents.size > 0 && !selectedAgents.has(r.agent_name)) return false;
      if (selectedActionTypes.size > 0 && !selectedActionTypes.has(r.action_type)) return false;
      if (selectedOutcomes.size > 0 && !selectedOutcomes.has(r.outcome)) return false;
      if (dateFrom && r.timestamp < dateFrom) return false;
      if (dateTo && r.timestamp > `${dateTo}T23:59:59Z`) return false;
      return true;
    });
  }, [records, selectedAgents, selectedActionTypes, selectedOutcomes, dateFrom, dateTo]);

  const presenceList = Object.values(presenceState);
  const activeFilterCount =
    selectedAgents.size +
    selectedActionTypes.size +
    selectedOutcomes.size +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  return (
    <div className="space-y-5">
      <LogPresenceBar presences={presenceList} currentUserId={currentUser.id} />

      {toast && (
        <div className="fixed top-6 right-6 z-50 rounded-md bg-slate-900 text-white text-sm px-4 py-3 shadow-lg">
          {toast}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div onClick={onFilterInteraction}>
              <CheckboxList
                label="Agent"
                options={filterOptions.agents}
                selected={selectedAgents}
                onChange={(next) => {
                  setSelectedAgents(next);
                  onFilterInteraction();
                }}
              />
            </div>
            <div onClick={onFilterInteraction}>
              <CheckboxList
                label="Action Type"
                options={filterOptions.actionTypes}
                selected={selectedActionTypes}
                onChange={(next) => {
                  setSelectedActionTypes(next);
                  onFilterInteraction();
                }}
              />
            </div>
            <div onClick={onFilterInteraction}>
              <CheckboxList
                label="Outcome"
                options={filterOptions.outcomes}
                selected={selectedOutcomes}
                onChange={(next) => {
                  setSelectedOutcomes(next);
                  onFilterInteraction();
                }}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">From</div>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  onFilterInteraction();
                }}
                className="h-9 w-40"
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">To</div>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  onFilterInteraction();
                }}
                className="h-9 w-40"
              />
            </div>
            {activeFilterCount > 0 && (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Clear filters ({activeFilterCount})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">{filtered.length}</span> of{" "}
        <span className="font-medium text-slate-900">{records.length}</span> records
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-8" />
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Timestamp</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Agent</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Action Type</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Description</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Outcome</th>
                <th className="text-left font-medium text-slate-600 px-4 py-2.5 text-xs uppercase tracking-wider">Decided By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const expanded = expandedId === r.id;
                const highlighted = highlightIds.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={cn(
                        "border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors",
                        highlighted && "bg-blue-50"
                      )}
                      onClick={() => onRowExpand(r.id)}
                    >
                      <td className="px-2 py-3">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDateTime(r.timestamp)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{r.agent_name}</td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.action_type}</td>
                      <td className="px-4 py-3 text-slate-700">{r.description}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <OutcomeBadge outcome={r.outcome} />
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.decided_by}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td></td>
                        <td colSpan={6} className="px-4 py-4">
                          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                            Reasoning
                          </div>
                          <div className="text-sm text-slate-700 leading-relaxed">{r.reasoning_summary}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    No records match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const lower = outcome.toLowerCase();
  const variant =
    lower.includes("approved") || lower === "resolved"
      ? "approved"
      : lower.includes("reject")
      ? "rejected"
      : lower.includes("pending")
      ? "pending"
      : lower.includes("auto")
      ? "reviewing"
      : "default";
  return <Badge variant={variant}>{outcome}</Badge>;
}
