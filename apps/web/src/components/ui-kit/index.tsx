import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page title + one-line description + optional actions, aligned on one baseline. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** One number with its label. Numbers are mono and tabular so columns line up. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card rounded-lg border p-4", className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mono-num mt-1.5 text-xl leading-none font-medium">{value}</div>
      {hint ? <div className="text-muted-foreground mt-2 text-xs">{hint}</div> : null}
    </div>
  );
}

/** Empty state: one sentence and, when there is one, one clear action. */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-muted-foreground text-sm">{children}</p>
      {action ? (
        <Button asChild size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "danger" | "info";
  children: ReactNode;
}) {
  const styles = {
    warning: "bg-warning-subtle text-warning",
    danger: "bg-danger-subtle text-danger",
    info: "bg-brand-subtle text-brand",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md px-3 py-2.5 text-sm", styles)}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Wraps a table so wide content scrolls inside its border instead of the page. */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="bg-card overflow-x-auto rounded-lg border">{children}</div>;
}
