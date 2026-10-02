import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  denied: "GitHub sign-in was cancelled.",
  expired: "The GitHub sign-in took too long. Try again.",
  state_mismatch: "The GitHub sign-in couldn't be verified. Try again.",
  github_unavailable: "GitHub didn't respond. Try again in a minute.",
  github_in_use: "That GitHub account is already connected to another contributor.",
  not_configured: "Connecting GitHub isn't available on this server yet.",
  sign_in_required: "Your X session expired. Sign in with X again, then connect GitHub.",
};

/**
 * GitHub ownership is proven by signing in to GitHub (read-only, the token is discarded), never by typing a username.
 * Pull requests and commits are paid only when their author is the connected account.
 */
export function GithubConnect({
  slug,
  login,
  verified,
  status,
  error,
}: {
  slug: string;
  login: string | null;
  verified: boolean;
  status?: string;
  error?: string;
}) {
  const start = `/api/auth/github/start?next=${encodeURIComponent(`/c/${slug}`)}`;
  return (
    <div className="grid gap-2">
      {verified && login ? (
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="text-success size-4" strokeWidth={1.5} aria-hidden="true" />
          <span>{login}</span>
          <span className="text-muted-foreground text-xs">verified</span>
        </span>
      ) : (
        <div className="grid gap-2">
          <span className="text-muted-foreground text-sm">
            Not connected. Needed to be paid for pull requests and commits.
          </span>
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a href={start}>Connect GitHub</a>
          </Button>
        </div>
      )}
      {status === "connected" ? <p className="text-success text-xs">GitHub connected.</p> : null}
      {error && ERRORS[error] ? (
        <p role="alert" className="text-danger text-xs">
          {ERRORS[error]}
        </p>
      ) : null}
    </div>
  );
}
