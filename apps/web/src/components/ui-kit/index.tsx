import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail for nested pages; the last item is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? (
              <ChevronRight className="size-3.5 opacity-60" strokeWidth={1.5} aria-hidden="true" />
            ) : null}
            {c.href ? (
              <Link href={c.href} className="hover:text-foreground rounded-sm transition-colors">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Breadcrumbs, title, one-line description and the page's primary action, the same on every page. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  crumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <div>
      {crumbs?.length ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-medium tracking-[-0.02em]">{title}</h1>
            {meta}
          </div>
          {description ? (
            <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A bordered surface with an optional title row; the one card style for content blocks. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("bg-card scroll-mt-20 rounded-xl border p-5 sm:p-6", className)}>
      {title ? (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium">{title}</h2>
            {description ? (
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
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
    <div className={cn("bg-card rounded-xl border p-4", className)}>
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
    <div className="rounded-xl border border-dashed px-6 py-12 text-center">
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
  return <div className="bg-card overflow-x-auto rounded-xl border">{children}</div>;
}
