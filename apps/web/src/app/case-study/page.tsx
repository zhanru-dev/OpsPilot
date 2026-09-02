import {
  ArrowRight,
  CheckCircle2,
  Database,
  GitBranch,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const evidence = [
  ["14", "persisted daily snapshots"],
  ["5/5", "AI contract evaluations"],
  ["2", "role-aware demo accounts"],
  ["1", "authoritative readiness engine"],
] as const;

const decisions = [
  {
    icon: ShieldCheck,
    title: "Rules remain authoritative",
    body: "The launch gate is calculated by deterministic server-side rules. AI can explain evidence and draft actions, but it cannot change readiness or transition an event.",
  },
  {
    icon: Sparkles,
    title: "AI is optional and reviewable",
    body: "Structured outputs are constrained to supplied evidence keys, persisted as recommendation runs, and require explicit manager confirmation. Failure falls back cleanly.",
  },
  {
    icon: Workflow,
    title: "Failures become product evidence",
    body: "Media processing and webhook delivery run through queues with retries, trace IDs and visible attempt history. Browser and API errors enter the same triage surface.",
  },
  {
    icon: Database,
    title: "Analytics are reproducible",
    body: "Operational metrics come from daily PostgreSQL snapshots, not hardcoded chart arrays. Users can change the range, refresh a snapshot and export the same data as CSV.",
  },
] as const;

export default function CaseStudyPage() {
  return (
    <main className="min-h-screen bg-white text-[var(--foreground)]">
      <header className="absolute inset-x-0 top-0 z-20 border-b border-white/15">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:px-8">
          <Link
            href="/case-study"
            className="flex items-center gap-3 text-white"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-[#277c7a]">
              <RadioTower className="size-5" />
            </span>
            <span className="font-bold">OpsPilot</span>
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/35 px-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            Open demo <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>

      <section className="relative flex min-h-[620px] items-end overflow-hidden bg-[#15262a] pt-24 text-white sm:min-h-[680px]">
        <Image
          src="/evidence/opspilot-analytics.png"
          alt="OpsPilot operational analytics interface"
          fill
          priority
          className="object-cover object-left-top opacity-45"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(17,32,36,0.96)_0%,rgba(17,32,36,0.82)_43%,rgba(17,32,36,0.3)_100%)]" />
        <div className="relative mx-auto w-full max-w-[1280px] px-5 pb-14 sm:px-8 sm:pb-16">
          <p className="text-xs font-bold uppercase text-[#8dd1cc]">
            Full-stack product case study
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
            OpsPilot
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[#d8e6e7] sm:text-xl">
            Launch readiness and operational control for complex online events.
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-[#b9cbcd] sm:text-base">
            An English-first portfolio product built with Next.js, NestJS,
            Prisma and PostgreSQL. It turns fragmented launch work into an
            evidence-backed workflow with permissions, queues, analytics and an
            optional grounded AI advisory.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2a7776] px-4 text-sm font-bold text-white hover:bg-[#236462]"
            >
              Explore the product <ArrowRight className="size-4" />
            </Link>
            <a
              href="#evidence"
              className="inline-flex h-11 items-center rounded-md border border-white/30 px-4 text-sm font-bold text-white hover:bg-white/10"
            >
              Review evidence
            </a>
          </div>
        </div>
      </section>

      <section
        id="evidence"
        className="border-b border-[var(--border)] bg-[#f4f7f7]"
      >
        <div className="mx-auto grid max-w-[1280px] grid-cols-2 px-5 sm:px-8 lg:grid-cols-4">
          {evidence.map(([value, label]) => (
            <div
              key={label}
              className="border-[var(--border)] px-3 py-7 first:border-l sm:px-6 lg:border-r"
            >
              <strong className="block text-2xl">{value}</strong>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                {label}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1280px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:py-24">
        <div>
          <p className="text-xs font-bold uppercase text-[var(--brand)]">
            The problem
          </p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">
            Operators need a launch decision, not another settings dashboard.
          </h2>
        </div>
        <div className="max-w-3xl text-base leading-8 text-[var(--muted)]">
          <p>
            Online event configuration is spread across ownership, audience
            access, content, media, runbooks and integrations. A missing rule or
            failed downstream delivery can become audience-facing at launch.
          </p>
          <p className="mt-5">
            OpsPilot brings those signals into Launch Control. The API explains
            every readiness criterion, blocks unsafe state transitions, records
            the actor and evidence, and emits reliable integration work after a
            successful change.
          </p>
        </div>
      </section>

      <section className="bg-[#16272b] py-20 text-white lg:py-24">
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
          <p className="text-xs font-bold uppercase text-[#8dd1cc]">
            System design
          </p>
          <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <h2 className="max-w-2xl text-3xl font-bold leading-tight">
              One workflow, with inspectable boundaries.
            </h2>
            <p className="max-w-xl text-sm leading-6 text-[#b9cbcd]">
              Tenant and role checks live in the API. Business mutations, audit
              entries and outbox records share transaction boundaries.
            </p>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-white/15 bg-white/15 md:grid-cols-4">
            {[
              "Next.js product UI",
              "NestJS REST API",
              "PostgreSQL + Prisma",
              "BullMQ workers",
            ].map((item, index) => (
              <div key={item} className="bg-[#1d3034] p-6">
                <span className="text-xs font-bold text-[#8dd1cc]">
                  0{index + 1}
                </span>
                <p className="mt-4 font-bold">{item}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 text-xs text-[#9db4b6]">
            <GitBranch className="size-4" /> HTTPS request to scoped command to
            transaction/outbox to worker to traceable outcome
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase text-[var(--brand)]">
            Engineering decisions
          </p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">
            AI supports operational judgment without owning it.
          </h2>
        </div>
        <div className="mt-10 grid border-l border-t border-[var(--border)] md:grid-cols-2">
          {decisions.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="border-b border-r border-[var(--border)] p-6 sm:p-8"
            >
              <Icon className="size-5 text-[var(--brand)]" />
              <h3 className="mt-5 text-lg font-bold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[#f4f7f7] py-20 lg:py-24">
        <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <p className="text-xs font-bold uppercase text-[var(--brand)]">
                Demonstrable outcomes
              </p>
              <h2 className="mt-3 text-3xl font-bold leading-tight">
                Claims backed by running paths.
              </h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {[
                "Managers can resolve a blocked launch end to end.",
                "Analysts see the same evidence without mutation controls.",
                "Webhook failures retain attempt and trace history.",
                "AI unavailability produces a visible audited fallback.",
                "Daily metrics export to the same CSV shown in the chart.",
                "Browser and API failures enter an operational triage list.",
              ].map((item) => (
                <div key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--success)]" />
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-[1280px] flex-col justify-between gap-5 px-5 py-10 sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="font-bold">OpsPilot v1.5</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Original clean-room portfolio implementation.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-bold text-white hover:bg-[var(--brand-strong)]"
          >
            Sign in to the demo <ArrowRight className="size-4" />
          </Link>
        </div>
      </footer>
    </main>
  );
}
