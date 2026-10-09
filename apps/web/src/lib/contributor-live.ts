/**
 * The contributor page's server-rendered parts (timeline, "You're in", totals) follow the submission list: they're
 * refreshed when a polled submission's status or decision changed, so they never lag behind the card.
 */
export function decisionChanged(
  prev: readonly { id: string; status: string; decision: { decisionHash: string } | null }[],
  fresh: readonly { id: string; status: string; decision: { decisionHash: string } | null }[],
): boolean {
  return fresh.some((f) => {
    const p = prev.find((x) => x.id === f.id);
    return !!p && (p.status !== f.status || p.decision?.decisionHash !== f.decision?.decisionHash);
  });
}
