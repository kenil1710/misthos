import Link from "next/link";
import { shortHex } from "@misthos/shared";
import { SignOutButton } from "@/components/app/sign-out-button";
import { SiteHeader } from "@/components/app/site-header";
import { OwnerSignIn } from "@/components/web3/owner-sign-in";
import { Web3Provider } from "@/components/web3/web3-provider";
import { getOwnerSession } from "@/lib/server/session";

export const metadata = { title: "App" };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const session = await getOwnerSession();
  return (
    <Web3Provider>
      <SiteHeader
        href="/app"
        nav={
          session ? (
            <>
              <Link href="/app" className="text-muted-foreground hover:text-foreground">
                Programs
              </Link>
              <Link
                href="/app/programs/new"
                className="text-muted-foreground hover:text-foreground"
              >
                New program
              </Link>
            </>
          ) : null
        }
        right={
          session ? (
            <>
              <span className="text-muted-foreground hidden font-mono text-[13px] sm:inline">
                {shortHex(session.addr)}
              </span>
              <SignOutButton kind="owner" />
            </>
          ) : null
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {session ? (
          children
        ) : (
          <section className="max-w-md">
            <h1 className="text-2xl font-semibold">Sign in to Misthos</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Connect the wallet that will own your programs. Signing in is a free signature, not a
              transaction.
            </p>
            <div className="mt-6">
              <OwnerSignIn />
            </div>
          </section>
        )}
      </main>
    </Web3Provider>
  );
}
