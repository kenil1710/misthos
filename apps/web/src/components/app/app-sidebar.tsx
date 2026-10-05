"use client";

import {
  BarChart3,
  BookOpen,
  Check,
  ChevronsUpDown,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  Plus,
  Repeat,
  ScrollText,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { AccountChip } from "@/components/app/account-chip";
import { WalletChipStatus } from "@/components/web3/islands";
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
  /** "Round 1 · closes in 6d", or null before publishing. */
  roundPill: string | null;
  needs: { text: string; href: string; action: string; kind: string }[];
  joinUrl: string;
  shareHref: string;
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
  contributor = false,
  onNavigate,
  wallet = true,
}: {
  programs: ShellProgram[];
  founder: boolean;
  address: string;
  /** Also signed in with X: link to the programs they joined. */
  contributor?: boolean;
  onNavigate?: () => void;
  /** Mount the wallet status (and so load the wallet code) only where the rail is actually on screen. */
  wallet?: boolean;
}) {
  const path = usePathname();
  const currentId = /^\/app\/programs\/([0-9a-f-]{36})/.exec(path)?.[1];
  const current = programs.find((p) => p.id === currentId);
  const base = current ? `/app/programs/${current.id}` : null;

  return (
    <div className="flex h-full flex-col gap-7 px-4 py-5">
      <div className="px-2">
        <Link
          href="/"
          aria-label="Misthos home"
          className="rounded-md"
          onClick={(e) => {
            if (e.detail > 0) e.currentTarget.blur();
            onNavigate?.();
          }}
        >
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
            href="/app/programs"
            exact
            icon={Layers}
            label="All programs"
            path={path}
            onNavigate={onNavigate}
          />
        )}
      </nav>

      <div className="grid gap-0.5">
        <p className="text-muted-foreground px-3 pb-1 text-xs">Workspace</p>
        {current ? (
          <NavItem
            href="/app/programs"
            exact
            icon={Layers}
            label="All programs"
            path={path}
            onNavigate={onNavigate}
          />
        ) : null}
        {contributor ? (
          <NavItem
            href="/c"
            exact
            icon={UserRound}
            label="Programs you joined"
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

      <div className="mt-auto">
        {wallet ? (
          <WalletChipStatus owner={address} className="w-full" />
        ) : (
          <AccountChip kind="owner" address={address} className="w-full" />
        )}
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
      <DropdownMenuTrigger className="bg-card shadow-soft hover:bg-card/80 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3">
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
        // Picking a program with the mouse shouldn't leave a focus ring on the trigger; keyboard use keeps it.
        onCloseAutoFocus={(e) => {
          if (!document.querySelector(":focus-visible")) e.preventDefault();
        }}
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
        "focus-visible:ring-foreground/20 flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-card text-foreground shadow-soft font-medium [&_svg]:text-brand"
          : "text-soft hover:bg-sidebar-accent/70 hover:text-foreground",
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
