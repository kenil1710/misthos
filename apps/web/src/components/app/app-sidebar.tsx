"use client";

import { shortHex } from "@misthos/shared";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronsUpDown,
  Inbox,
  Landmark,
  LayoutDashboard,
  Layers,
  Plus,
  Repeat,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { SignOutButton } from "@/components/app/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ShellProgram {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "active" | "paused" | "archived";
  review: number;
}

const STATUS_DOT: Record<ShellProgram["status"], string> = {
  active: "bg-success",
  draft: "bg-muted-foreground/50",
  paused: "bg-warning",
  archived: "bg-muted-foreground/30",
};

export function AppSidebar({
  programs,
  founder,
  address,
  onNavigate,
}: {
  programs: ShellProgram[];
  founder: boolean;
  address: string;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const currentId = /^\/app\/programs\/([0-9a-f-]{36})/.exec(path)?.[1];
  const current = programs.find((p) => p.id === currentId);
  const base = current ? `/app/programs/${current.id}` : null;

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <div className="px-2">
        <Link href="/app" aria-label="Misthos home" className="rounded-md" onClick={onNavigate}>
          <Wordmark />
        </Link>
      </div>

      <ProgramSwitcher programs={programs} current={current} onNavigate={onNavigate} />

      <nav aria-label="Program" className="grid gap-0.5">
        {base && current ? (
          <>
            <NavItem
              href={base}
              exact
              icon={LayoutDashboard}
              label="Overview"
              path={path}
              onNavigate={onNavigate}
            />
            <NavItem
              href={`${base}/submissions`}
              icon={Inbox}
              label="Submissions"
              path={path}
              onNavigate={onNavigate}
              badge={current.review ? <CountBadge n={current.review} label="need review" /> : null}
            />
            <NavItem
              href={`${base}/contributors`}
              icon={Users}
              label="Contributors"
              path={path}
              onNavigate={onNavigate}
            />
            <NavItem
              href={`${base}/rounds`}
              icon={Repeat}
              label="Rounds"
              path={path}
              onNavigate={onNavigate}
            />
            <NavItem
              href={`${base}/treasury`}
              icon={Landmark}
              label="Treasury"
              path={path}
              onNavigate={onNavigate}
            />
            <NavItem
              href={`${base}/audit`}
              icon={ScrollText}
              label="Audit log"
              path={path}
              onNavigate={onNavigate}
            />
            <NavItem
              href={`${base}/settings`}
              icon={Settings}
              label="Settings"
              path={path}
              onNavigate={onNavigate}
            />
          </>
        ) : (
          <NavItem
            href="/app"
            exact
            icon={Layers}
            label="All programs"
            path={path}
            onNavigate={onNavigate}
          />
        )}
      </nav>

      <div className="grid gap-0.5">
        <p className="text-muted-foreground px-2 pb-1 text-xs">Workspace</p>
        {current ? (
          <NavItem
            href="/app"
            exact
            icon={Layers}
            label="All programs"
            path={path}
            onNavigate={onNavigate}
          />
        ) : null}
        {founder ? (
          <NavItem
            href="/app/admin/metrics"
            icon={BarChart3}
            label="Metrics"
            path={path}
            onNavigate={onNavigate}
          />
        ) : null}
        <NavItem href="/docs" icon={BookOpen} label="Docs" path={path} onNavigate={onNavigate} />
      </div>

      <div className="mt-auto border-t pt-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <WalletAvatar address={address} />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs leading-tight">Signed in</p>
            <p className="truncate font-mono text-[13px] leading-tight" title={address}>
              {shortHex(address)}
            </p>
          </div>
          <ThemeToggle />
        </div>
        <div className="px-2 pt-1">
          <SignOutButton
            kind="owner"
            className="text-muted-foreground hover:text-foreground h-8 w-full justify-start px-0"
          />
        </div>
      </div>
    </div>
  );
}

function ProgramSwitcher({
  programs,
  current,
  onNavigate,
}: {
  programs: ShellProgram[];
  current?: ShellProgram;
  onNavigate?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hover:bg-sidebar-accent focus-visible:ring-ring/50 data-[state=open]:bg-sidebar-accent flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3">
        {current ? (
          <>
            <span
              className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[current.status])}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground flex-1">
            {programs.length ? "Choose a program" : "No programs yet"}
          </span>
        )}
        <ChevronsUpDown
          className="text-muted-foreground size-4 shrink-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="sr-only">Switch program</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        {programs.length ? (
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Programs
          </DropdownMenuLabel>
        ) : null}
        {programs.map((p) => (
          <DropdownMenuItem key={p.id} asChild>
            <Link href={`/app/programs/${p.id}`} onClick={onNavigate} className="gap-2.5">
              <span
                className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[p.status])}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === current?.id ? <Check className="size-4" strokeWidth={1.5} /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        {programs.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link href="/app/programs/new" onClick={onNavigate} className="gap-2.5">
            <Plus className="size-4" strokeWidth={1.5} />
            New program
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small deterministic identicon from the wallet address: two stone tones, no colour noise. */
function WalletAvatar({ address }: { address: string }) {
  const bits = parseInt(address.slice(2, 10), 16);
  const cells = Array.from({ length: 9 }, (_, i) => (bits >> i) & 1);
  return (
    <span
      aria-hidden="true"
      className="bg-muted grid size-7 shrink-0 grid-cols-3 gap-px overflow-hidden rounded-full border p-1.5"
    >
      {cells.map((on, i) => (
        <span key={i} className={on ? "bg-foreground/55 rounded-[1px]" : ""} />
      ))}
    </span>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  path,
  exact = false,
  badge,
  onNavigate,
}: {
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  path: string;
  exact?: boolean;
  badge?: ReactNode;
  onNavigate?: () => void;
}) {
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={(e) => {
        // A mouse click shouldn't leave a focus ring behind (some browsers show one); keyboard focus keeps it.
        if (e.detail > 0) e.currentTarget.blur();
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-foreground/20 flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-sidebar-accent text-foreground font-medium"
          : "text-soft hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1">{label}</span>
      {badge}
    </Link>
  );
}

function CountBadge({ n, label }: { n: number; label: string }) {
  return (
    <span
      className="bg-warning-subtle text-warning inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums"
      aria-label={`${n} ${label}`}
    >
      {n}
    </span>
  );
}
