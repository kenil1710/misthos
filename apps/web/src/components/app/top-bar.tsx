"use client";

import { Bell, CheckCircle2, Copy, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ShellProgram } from "./app-sidebar";

/** What the bell lists: the current program's needs, or every program's on workspace pages. */
type Need = ShellProgram["needs"][number] & { programName?: string };

function pillTone(pill: string) {
  if (/ends in|closing/.test(pill)) return "bg-success";
  if (/paying/.test(pill)) return "bg-warning";
  if (/failed/.test(pill)) return "bg-danger";
  return "bg-muted-foreground/60";
}

/** The round pill: where the current program is in its round, at a glance. */
export function RoundPill({ pill, className }: { pill: string; className?: string }) {
  return (
    <span
      className={cn(
        "bg-card shadow-soft inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-sm whitespace-nowrap",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", pillTone(pill))} aria-hidden="true" />
      {pill}
    </span>
  );
}

/** "Needs you" bell: the count, and the list one click away. */
export function NeedsBell({ needs }: { needs: Need[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={needs.length ? `Needs you: ${needs.length}` : "Needs you: nothing"}
        >
          <Bell className="size-4" strokeWidth={1.75} />
          {needs.length ? (
            <span className="bg-warning text-background absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
              {needs.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="px-2 pt-1 pb-2 text-sm font-medium">
          Needs you
        </DropdownMenuLabel>
        {needs.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 px-2 pb-2 text-sm">
            <CheckCircle2 className="text-success size-4" strokeWidth={1.75} aria-hidden="true" />
            You&apos;re all caught up.
          </p>
        ) : (
          needs.map((n, i) => (
            <DropdownMenuItem key={`${n.href}-${i}`} asChild className="items-start rounded-lg p-2">
              <Link href={n.href} className="grid gap-0.5">
                {n.programName ? (
                  <span className="text-muted-foreground text-xs">{n.programName}</span>
                ) : null}
                <span className="text-sm leading-snug">{n.text}</span>
                <span className="text-brand text-xs font-medium">{n.action} →</span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Share the join link: copy it, post it on X, or open the page. */
export function ShareMenu({ program }: { program: ShellProgram }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
          <Share2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Share join link
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(program.joinUrl);
              toast.success("Join link copied");
            } catch {
              window.prompt("Copy this link", program.joinUrl);
            }
          }}
        >
          <Copy className="size-4" strokeWidth={1.5} /> Copy join link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={program.shareHref} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={program.joinUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" strokeWidth={1.5} /> Open join page
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The bar above every owner page: round status on the left; what needs you, sharing and theme on the right. */
export function TopBar({
  current,
  programs,
}: {
  current?: ShellProgram;
  programs: ShellProgram[];
}) {
  const needs: Need[] = current
    ? current.needs
    : programs.flatMap((p) => p.needs.map((n) => ({ ...n, programName: p.name })));
  const published = current && (current.status === "active" || current.status === "paused");
  return (
    <div className="bg-background/80 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 supports-[backdrop-filter]:backdrop-blur-md lg:flex">
      <div className="flex min-w-0 items-center gap-2">
        {current?.roundPill ? <RoundPill pill={current.roundPill} /> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <NeedsBell needs={needs} />
        {current && published ? <ShareMenu program={current} /> : null}
        <ThemeToggle />
      </div>
    </div>
  );
}
