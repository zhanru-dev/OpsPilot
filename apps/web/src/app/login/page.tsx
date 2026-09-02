"use client";

import {
  BarChart3,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/features/auth/auth-provider";

const DEMO_PASSWORD = "DemoPass123!";
const DEMO_ACCOUNTS = [
  {
    name: "Alex Morgan",
    role: "Operations Manager",
    email: "alex.morgan@opspilot.demo",
    icon: ShieldCheck,
  },
  {
    name: "Maya Chen",
    role: "Audience Analyst",
    email: "maya.chen@opspilot.demo",
    icon: BarChart3,
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDemoEmail, setSelectedDemoEmail] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");

  function fillDemoCredentials(account: (typeof DEMO_ACCOUNTS)[number]) {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setSelectedDemoEmail(account.email);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen min-w-0 bg-white lg:grid-cols-[minmax(420px,0.8fr)_1.2fr]">
      <section className="flex min-h-screen min-w-0 flex-col justify-between border-r border-[var(--border)] px-6 py-7 sm:px-10 lg:px-14">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-[var(--brand)] text-white">
            <RadioTower className="size-5" />
          </span>
          <span className="text-lg font-bold">OpsPilot</span>
        </div>
        <div className="mx-auto w-full min-w-0 max-w-md py-12">
          <p className="mb-3 text-xs font-bold uppercase text-[var(--brand)]">
            Portfolio demo
          </p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            Sign in to OpsPilot
          </h1>
          <p className="mt-4 text-base leading-7 text-[var(--muted)]">
            Your workspace role and permissions are assigned to your account.
          </p>
          <form className="mt-8" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="text-sm font-semibold">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSelectedDemoEmail(null);
                }}
                className="mt-2 h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
              />
            </div>
            <div className="mt-5">
              <label htmlFor="password" className="text-sm font-semibold">
                Password
              </label>
              <div className="relative mt-2">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setSelectedDemoEmail(null);
                  }}
                  className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 pr-11 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-md bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-bold text-white hover:bg-[var(--brand-strong)] disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <section
            className="mt-8 border-t border-[var(--border)] pt-6"
            aria-labelledby="demo-accounts-heading"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="demo-accounts-heading" className="text-sm font-bold">
                Demo accounts
              </h2>
              <span className="text-xs text-[var(--muted)]">
                Click Use, then sign in
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((account) => {
                const Icon = account.icon;
                const selected = selectedDemoEmail === account.email;
                return (
                  <div
                    key={account.email}
                    className={`flex items-center gap-3 rounded-md border p-3 ${selected ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)]"}`}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#eef3f9] text-[var(--blue)]">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {account.name}
                      </span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {account.role} · {account.email}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => fillDemoCredentials(account)}
                      aria-label={`Use ${account.name} demo account`}
                      className="shrink-0 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold hover:border-[var(--brand)] hover:text-[var(--brand)]"
                    >
                      {selected ? "Added" : "Use"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-2">
            <LockKeyhole className="size-4" /> Deterministic demo data · No
            external AI dependency
          </span>
          <Link
            href="/case-study"
            className="font-bold text-[var(--brand)] hover:underline"
          >
            Read the case study
          </Link>
        </div>
      </section>
      <section className="hidden min-h-screen bg-[#eef2f3] p-10 lg:flex lg:items-center lg:justify-center">
        <div className="w-full max-w-3xl overflow-hidden rounded-md border border-[#cbd4d8] bg-white shadow-xl">
          <div className="flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--sidebar)] px-4 text-white">
            <span className="text-sm font-semibold">
              Global Product Briefing
            </span>
            <span className="rounded border border-white/20 px-2 py-1 text-[10px] font-bold">
              CONFIGURING
            </span>
          </div>
          <div className="grid grid-cols-[180px_1fr]">
            <div className="border-r border-[var(--border)] bg-[#f8fafb] p-4">
              <div className="mb-6 h-2 w-24 rounded bg-[#cbd5d9]" />
              {[72, 96, 84, 64, 88].map((width) => (
                <div
                  key={width}
                  className="mb-4 h-2 rounded bg-[#dfe5e8]"
                  style={{ width }}
                />
              ))}
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <div className="h-3 w-32 rounded bg-[#c4ced2]" />
                  <div className="mt-3 h-2 w-48 rounded bg-[#e0e6e8]" />
                </div>
                <div className="flex size-20 items-center justify-center rounded-full border-[9px] border-[#e5b85e] text-xl font-bold">
                  35
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["Access policy", "Media asset", "Runbook"].map(
                  (label, index) => (
                    <div
                      key={label}
                      className="rounded border border-[var(--border)] p-3"
                    >
                      <div
                        className={`mb-3 flex size-7 items-center justify-center rounded ${index === 2 ? "bg-[var(--amber-soft)] text-[var(--amber)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}
                      >
                        {index === 2 ? (
                          <CheckCircle2 className="size-4" />
                        ) : (
                          "!"
                        )}
                      </div>
                      <span className="text-xs font-semibold">{label}</span>
                      <div className="mt-2 h-1.5 w-full rounded bg-[#e5eaec]" />
                    </div>
                  ),
                )}
              </div>
              <div className="mt-5 rounded border border-[var(--border)] p-4">
                <div className="h-2 w-36 rounded bg-[#c5ced2]" />
                {[
                  "Audience access is missing",
                  "No ready media is attached",
                  "Critical task remains open",
                ].map((item) => (
                  <div key={item} className="mt-4 flex items-center gap-3">
                    <span className="size-2 rounded-full bg-[var(--danger)]" />
                    <span className="text-xs text-[var(--muted)]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
