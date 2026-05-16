"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { KpiCard } from "@/components/kpi-card";
import {
  supportReflexKpis,
  supportInquiryVolume,
  supportResolutionTrend,
  supportIssuePatterns,
  type IssuePattern,
} from "@/lib/dummy-data-lifetime";
import {
  escalationModeLabel,
  supportEscalationLanes,
  summarizeSupportEscalation,
  type SupportEscalationLane,
} from "@/lib/support-orchestration";
import { cn } from "@/lib/utils";

export function SupportReflexAgentView() {
  const [isActive, setIsActive] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submittingLaneId, setSubmittingLaneId] = useState<string | null>(null);
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set());
  const [submittedLaneIds, setSubmittedLaneIds] = useState<Set<string>>(new Set());
  const escalationSummary = summarizeSupportEscalation(supportEscalationLanes);

  async function submitImprovement(p: IssuePattern) {
    setSubmittingId(p.id);
    try {
      const res = await fetch("/api/approvals/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_name: "Support Reflex Agent",
          queue: "operations",
          action_description: `Process improvement: ${p.proposedImprovement} (addresses pattern affecting ${p.affectedCustomers} customers / ${p.frequency} tickets)`,
          financial_impact: `Affects ~${p.frequency} tickets/month`,
          impact_amount: null,
        }),
      });
      if (res.ok) setSubmittedIds((prev) => new Set(prev).add(p.id));
    } finally {
      setSubmittingId(null);
    }
  }

  async function submitEscalationLane(lane: SupportEscalationLane) {
    setSubmittingLaneId(lane.id);
    try {
      const res = await fetch("/api/approvals/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_name: lane.owner,
          queue: "operations",
          action_description: `Runbook review: ${lane.lane}. Guardrail: ${lane.guardrail}`,
          financial_impact: `${lane.projectedImpact} Approval trigger: ${lane.approvalTrigger}`,
          impact_amount: null,
        }),
      });
      if (res.ok) setSubmittedLaneIds((prev) => new Set(prev).add(lane.id));
    } finally {
      setSubmittingLaneId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Support Reflex Agent</CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Autonomous support issue resolution and pattern detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-medium", isActive ? "text-emerald-700" : "text-slate-500")}>
            {isActive ? "Active" : "Paused"}
          </span>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            label="Autonomous Resolution Rate"
            value={`${supportReflexKpis.autonomousResolutionRate}%`}
            trend="up"
            subtext="+8% vs prior 30d"
          />
          <KpiCard
            label="Avg Resolution Time"
            value={`${supportReflexKpis.avgResolutionTime}h`}
            trend="down"
            subtext="-1.2h vs prior 30d"
          />
          <KpiCard
            label="Cost per Interaction"
            value={`$${supportReflexKpis.costPerInteraction.toFixed(2)}`}
            trend="down"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Support control plane
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Evidence-gated escalation lanes for ecommerce support autonomy
              </p>
            </div>
            <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
              <span>
                <span className="font-mono font-semibold text-slate-800">{escalationSummary.evidenceChecks}</span> checks
              </span>
              <span>
                <span className="font-mono font-semibold text-slate-800">{escalationSummary.approvalRequired + escalationSummary.humanHandoff}</span> supervised lanes
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {supportEscalationLanes.map((lane) => {
              const queued = submittedLaneIds.has(lane.id);
              const modeLabel = escalationModeLabel(lane.mode);
              return (
                <div key={lane.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{lane.lane}</p>
                      <span
                        className={cn(
                          "mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                          lane.mode === "autonomous" && "bg-emerald-50 text-emerald-700",
                          lane.mode === "approval_required" && "bg-amber-50 text-amber-700",
                          lane.mode === "human_handoff" && "bg-rose-50 text-rose-700"
                        )}
                      >
                        {modeLabel}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mt-3">{lane.guardrail}</p>
                  <div className="mt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Evidence package</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {lane.evidence.map((item) => (
                        <span key={item} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-3">{lane.projectedImpact}</p>
                  <Button
                    size="sm"
                    className="mt-4 w-full"
                    disabled={!isActive || queued || submittingLaneId === lane.id}
                    onClick={() => submitEscalationLane(lane)}
                  >
                    {queued ? "Queued" : submittingLaneId === lane.id ? "Submitting..." : "Queue Runbook Review"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Inquiry volume by category
            </h3>
            <div className="rounded-md border border-slate-200 p-4 bg-white">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={supportInquiryVolume} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString()} tickets`} />
                  <Bar dataKey="volume" radius={[0, 6, 6, 0]}>
                    {supportInquiryVolume.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.volume >= 1000 ? "#f43f5e" : entry.volume >= 500 ? "#f59e0b" : entry.volume >= 300 ? "#6366f1" : "#10b981"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Resolution time trend</h3>
            <div className="rounded-md border border-slate-200 p-4 bg-white">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={supportResolutionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                  <Tooltip formatter={(v) => `${v}h`} />
                  <Line type="monotone" dataKey="hours" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} name="Avg resolution" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Recurring issue patterns</h3>
          <div className="space-y-3">
            {supportIssuePatterns.map((p) => {
              const submitted = submittedIds.has(p.id);
              return (
                <div key={p.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{p.pattern}</p>
                      <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                        <span>
                          <span className="font-mono font-semibold text-slate-700">{p.frequency}</span> tickets
                        </span>
                        <span>
                          <span className="font-mono font-semibold text-slate-700">{p.affectedCustomers}</span> customers affected
                        </span>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Proposed</span>
                        <p className="text-slate-700 mt-0.5">{p.proposedImprovement}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={!isActive || submitted || submittingId === p.id}
                      onClick={() => submitImprovement(p)}
                    >
                      {submitted ? "Queued" : submittingId === p.id ? "Submitting…" : "Submit for Approval"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
