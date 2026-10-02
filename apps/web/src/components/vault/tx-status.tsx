export function TxStatus({ status, error }: { status: string | null; error: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-danger text-sm">
        {error}
      </p>
    );
  if (status)
    return (
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {status}
      </p>
    );
  return null;
}
