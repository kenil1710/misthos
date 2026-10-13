import { Notice } from "@/components/ui-kit";

/** Shown in place of on-chain vault numbers when Arc couldn't be read for this request. */
export function VaultUnavailable({ href }: { href: string }) {
  return (
    <Notice tone="warning">
      Vault data is unavailable right now: Arc didn&apos;t answer in time. Your funds and settings
      are unaffected. {/* A full reload, so the read runs again. */}
      <a href={href} className="font-medium underline underline-offset-4">
        Retry
      </a>
    </Notice>
  );
}
