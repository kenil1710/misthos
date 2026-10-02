import { Button } from "@/components/ui/button";

/** Opens X's composer in a new tab with the announcement filled in; nothing is posted without the owner. */
export function ShareOnX({ href, size = "sm" }: { href: string; size?: "sm" | "default" }) {
  return (
    <Button asChild variant="outline" size={size}>
      <a href={href} target="_blank" rel="noreferrer">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-current">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share on X
      </a>
    </Button>
  );
}
