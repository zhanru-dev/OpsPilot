"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  ClipboardCheck,
  LayoutDashboard,
  Library,
  MonitorUp,
  PlugZap,
  LogOut,
  Menu,
  RadioTower,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import { cn, humanize } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/streamops/events", label: "Events", icon: RadioTower },
  { href: "/streamops/live", label: "Live Operations", icon: MonitorUp },
  { href: "/streamops/media", label: "Media Library", icon: Library },
  { href: "/integrations", label: "Integration Centre", icon: PlugZap },
  { href: "/audit-logs", label: "Audit Logs", icon: ClipboardCheck },
  { href: "/settings", label: "Workspace", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useQuery({
    queryKey: ["health", "ready"],
    queryFn: () => apiFetch<{ status: string }>("/health/ready", {}, false),
    enabled: Boolean(user),
    retry: false,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  if (loading || !user)
    return (
      <div className="min-h-screen bg-[var(--background)]">
        <LoadingState label="Opening workspace" />
      </div>
    );

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-[var(--sidebar)] text-white">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <span className="flex size-9 items-center justify-center rounded-md bg-[#2a7776]">
          <RadioTower className="size-5" />
        </span>
        <div>
          <div className="font-bold">OpsPilot</div>
          <div className="text-[10px] font-semibold uppercase text-[#9bb4b6]">
            StreamOps
          </div>
        </div>
      </div>
      <div className="border-b border-white/10 px-4 py-4">
        <div className="rounded-md bg-white/7 p-3">
          <span>
            <span className="block text-xs text-[#9bb4b6]">Workspace</span>
            <span className="mt-1 block text-sm font-semibold">
              {user.workspaceName}
            </span>
          </span>
        </div>
      </div>
      <nav
        className="flex-1 space-y-1 px-3 py-5"
        aria-label="Primary navigation"
      >
        {navigation.map(({ href, label, icon: Icon }) => {
          const liveRoomPath =
            pathname.startsWith("/streamops/events/") &&
            pathname.endsWith("/live");
          const active =
            href === "/streamops/live"
              ? pathname === href || liveRoomPath
              : href === "/streamops/events"
                ? !liveRoomPath &&
                  (pathname === href || pathname.startsWith(`${href}/`))
                : pathname === href ||
                  (href !== "/dashboard" && pathname.startsWith(`${href}/`));
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold text-[#b9c8ca] hover:bg-white/8 hover:text-white",
                active && "bg-[#2a7776] text-white",
              )}
            >
              <Icon className="size-[18px]" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm text-[#b9c8ca] hover:bg-white/8 hover:text-white"
        >
          <LogOut className="size-[18px]" /> Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        {sidebar}
      </div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-64">
            {sidebar}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-2 text-white"
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--border)] bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden"
              title="Open navigation"
            >
              <Menu className="size-5" />
            </Button>
            <div className="hidden items-center gap-2 text-xs font-semibold text-[var(--muted)] sm:flex">
              <Activity
                className={`size-4 ${
                  health.isSuccess
                    ? "text-[var(--success)]"
                    : health.isError
                      ? "text-[var(--danger)]"
                      : "text-[var(--muted)]"
                }`}
              />
              {health.isSuccess
                ? "API operational"
                : health.isError
                  ? "API unavailable"
                  : "Checking API"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">
                {user.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div className="hidden sm:block">
                <div className="text-sm font-semibold">{user.name}</div>
                <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  {user.role === "ANALYST" ? (
                    <Activity className="size-3" />
                  ) : (
                    <ShieldCheck className="size-3" />
                  )}
                  {humanize(user.role)}
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-[1540px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
