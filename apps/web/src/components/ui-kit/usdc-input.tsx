"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A money (or hours) input with its unit always visible, helper text, and an inline error. */
export function UsdcInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  hint,
  error,
  unit = "USDC",
  className,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  hint?: ReactNode;
  error?: string | null;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={className ?? "grid max-w-sm gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className="pr-16 font-mono tabular-nums"
          value={value}
          aria-invalid={!!error}
          aria-describedby={`${id}-help`}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
          {unit}
        </span>
      </div>
      <div id={`${id}-help`} className="grid gap-0.5 text-xs leading-relaxed">
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        {hint ? <p className="text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
