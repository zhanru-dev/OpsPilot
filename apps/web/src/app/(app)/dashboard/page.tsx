"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Gauge,
  Lightbulb,
  RadioTower,
} from "lucide-react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { PageHeader } from "@/components/layout/page-header";
import { apiFetch } from "@/lib/api";
import { canManageEvents } from "@/lib/permissions";
import type { AuditLog, Recommendation, StreamEvent } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Summary = {
  kpis: {
    upcomingEvents: number;
    atRiskEvents: number;
    averageReadiness: number;
    openRecommendations: number;
  };
  upcomingEvents: StreamEvent[];
  readinessDistribution: Array<{ label: string; value: number }>;
  openRecommendations: Array<
    Recommendation & { event: { id: string; title: string } }
  >;
  recentActivity: AuditLog[];
};

const chartColours = ["#357454", "#d39935", "#a13b39"];

export default function DashboardPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<Summary>("/dashboard/summary"),
  });
  if (query.isLoading)
    return <LoadingState label="Loading operations overview" />;
  if (query.error || !query.data)
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Dashboard data is unavailable."
        }
        retry={() => query.refetch()}
      />
    );
  const data = query.data;
  const kpis = [
    {
      label: "Upcoming events",
      value: data.kpis.upcomingEvents,
      icon: CalendarDays,
      tone: "text-[var(--blue)] bg-[#e8eef7]",
    },
    {
      label: "At-risk launches",
      value: data.kpis.atRiskEvents,
      icon: AlertTriangle,
      tone: "text-[var(--danger)] bg-[var(--danger-soft)]",
    },
    {
      label: "Average readiness",
      value: `${data.kpis.averageReadiness}%`,
      icon: Gauge,
      tone: "text-[var(--brand)] bg-[var(--brand-soft)]",
    },
    {
      label: "Open recommendations",
      value: data.kpis.openRecommendations,
      icon: Lightbulb,
      tone: "text-[var(--amber)] bg-[var(--amber-soft)]",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Operations overview"
        title="Launch readiness at a glance"
        description="Prioritise the events that need intervention before their audience is affected."
        actions={canManageEvents(user?.role) ? (
          <Link
            href="/streamops/events/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]"
          >
            <RadioTower className="size-4" /> New event
          </Link>
        ) : null}
      />
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Key performance indicators"
      >
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <div
            key={label}
            className="rounded-md border border-[var(--border)] bg-white p-5"
          >
            <div className="flex items-start justify-between">
              <span
                className={`flex size-9 items-center justify-center rounded-md ${tone}`}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="text-2xl font-bold">{value}</span>
            </div>
            <p className="mt-5 text-xs font-semibold text-[var(--muted)]">
              {label}
            </p>
          </div>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.7fr)]">
        <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-bold">Upcoming events</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Ordered by launch time
              </p>
            </div>
            <Link
              href="/streamops/events"
              className="flex items-center gap-1 text-xs font-bold text-[var(--brand)]"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {data.upcomingEvents.map((event) => (
              <Link
                key={event.id}
                href={`/streamops/events/${event.id}`}
                className="block p-4 hover:bg-[#fafbfb]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold">{event.title}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {formatDate(event.scheduledStart, true, event.timezone)}
                    </p>
                  </div>
                  <Badge value={event.status} />
                </div>
                <ReadinessMeter readiness={event.readiness} className="mt-4" />
              </Link>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[#f7f9fa] text-[11px] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-4 py-3">Launch</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Readiness</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.upcomingEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="border-t border-[var(--border)] hover:bg-[#fafbfb]"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold">{event.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        {event.owner?.name ?? "Unassigned"}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-[var(--muted)]">
                      {formatDate(
                        event.scheduledStart,
                        true,
                        event.timezone,
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <Badge value={event.status} />
                    </td>
                    <td className="px-4 py-4">
                      <ReadinessMeter
                        readiness={event.readiness}
                        className="w-40"
                      />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/streamops/events/${event.id}`}
                        className="text-xs font-bold text-[var(--brand)]"
                      >
                        Open control
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <h2 className="font-bold">Portfolio readiness</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Upcoming launch distribution
          </p>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.readinessDistribution}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={72}
                  paddingAngle={3}
                >
                  {data.readinessDistribution.map((entry, index) => (
                    <Cell key={entry.label} fill={chartColours[index]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {data.readinessDistribution.map((entry, index) => (
              <div
                key={entry.label}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: chartColours[index] }}
                  />
                  {entry.label}
                </span>
                <strong>{entry.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="font-bold">Priority recommendations</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Evidence-backed operational actions
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {data.openRecommendations.map((item) => (
              <Link
                key={item.id}
                href={`/streamops/events/${item.event.id}`}
                className="block px-5 py-4 hover:bg-[#fafbfb]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge value={item.severity} />
                      <span className="text-xs text-[var(--muted)]">
                        {item.event.title}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold">{item.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      {item.summary}
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-[var(--muted)]" />
                </div>
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="font-bold">Recent activity</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Latest accountable actions
            </p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {data.recentActivity.map((item) => (
              <div key={item.id} className="flex gap-3 px-5 py-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] font-bold">
                  {item.actor?.avatarInitials ?? "SY"}
                </span>
                <div>
                  <p className="text-sm leading-5">{item.summary}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.actor?.name ?? "System"} ·{" "}
                    {formatDate(item.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
