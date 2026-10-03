import type { BrowserContext, Page } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface TestWallet {
  /** The first account (the one a test usually signs in with). */
  address: Hex;
  addresses: Hex[];
  /** Every personal_sign request the page made, in order. */
  signRequests: { address: string; at: number }[];
  /** Switch the wallet to another of its accounts, like picking one in the extension (emits accountsChanged). */
  switchAccount(page: Page, index: number): Promise<void>;
  /** Move the wallet to another network (emits chainChanged). */
  setChain(page: Page, chainId: number): Promise<void>;
  /** Disconnect from the site in the extension (emits accountsChanged with no accounts). */
  revoke(page: Page): Promise<void>;
  /** Make the next request of this method fail as "user rejected" (EIP-1193 4001). */
  rejectNext(page: Page, method: string): Promise<void>;
}

/**
 * Inject a minimal EIP-1193 wallet (looks like MetaMask to wagmi) backed by local viem keys. Signing happens in
 * the test process; the page only ever sees signatures, as with a real extension. Supports several accounts,
 * switching accounts and networks, revoking access and rejecting requests, so wallet edge cases can be tested.
 */
export async function injectWallet(
  context: BrowserContext,
  privateKey: Hex | Hex[],
  chainId = 5042002,
): Promise<TestWallet & ReturnType<typeof privateKeyToAccount>> {
  const accounts = (Array.isArray(privateKey) ? privateKey : [privateKey]).map((k) =>
    privateKeyToAccount(k),
  );
  const signRequests: { address: string; at: number }[] = [];
  await context.exposeFunction("__e2eSign", async (address: string, data: Hex) => {
    signRequests.push({ address, at: Date.now() });
    const acct = accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (!acct) throw new Error("unknown account");
    return acct.signMessage({ message: { raw: data } });
  });
  await context.addInitScript(
    ({ addresses, chainIdHex }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const emit = (event: string, ...args: unknown[]) =>
        (listeners[event] ?? []).forEach((cb) => cb(...args));
      // Like a real extension: no accounts are exposed until the site requests access, and the permission and the
      // selected account are remembered for the site across reloads.
      const KEY = "__e2e_wallet";
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
        authorized?: boolean;
        index?: number;
        chainId?: string;
      };
      const state = {
        authorized: saved.authorized ?? localStorage.getItem("__e2e_wallet_authorized") === "1",
        index: saved.index ?? 0,
        chainId: saved.chainId ?? chainIdHex,
        reject: new Set<string>(),
      };
      const save = () =>
        localStorage.setItem(
          KEY,
          JSON.stringify({
            authorized: state.authorized,
            index: state.index,
            chainId: state.chainId,
          }),
        );
      const current = () => (state.authorized ? [addresses[state.index]!] : []);
      const userRejected = (method: string) =>
        Object.assign(new Error(`User rejected the request (${method}).`), { code: 4001 });
      const provider = {
        isMetaMask: true,
        on(event: string, cb: (...a: unknown[]) => void) {
          (listeners[event] ??= []).push(cb);
          return provider;
        },
        removeListener(event: string, cb: (...a: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb);
          return provider;
        },
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (state.reject.has(method)) {
            state.reject.delete(method);
            throw userRejected(method);
          }
          switch (method) {
            case "eth_requestAccounts":
              state.authorized = true;
              save();
              return current();
            case "eth_accounts":
              return current();
            case "eth_chainId":
              return state.chainId;
            case "net_version":
              return String(parseInt(state.chainId, 16));
            case "wallet_switchEthereumChain": {
              state.chainId = (params![0] as { chainId: string }).chainId;
              save();
              emit("chainChanged", state.chainId);
              return null;
            }
            case "wallet_addEthereumChain":
              return null;
            case "wallet_requestPermissions":
              state.authorized = true;
              save();
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_getPermissions":
              return state.authorized ? [{ parentCapability: "eth_accounts" }] : [];
            case "wallet_revokePermissions":
              state.authorized = false;
              save();
              emit("accountsChanged", []);
              return null;
            case "personal_sign":
              return (
                window as unknown as { __e2eSign: (a: string, d: string) => Promise<string> }
              ).__e2eSign(params![1] as string, params![0] as string);
            default:
              throw Object.assign(new Error(`e2e wallet: unsupported ${method}`), { code: 4200 });
          }
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;
      (window as unknown as { __e2eWallet: unknown }).__e2eWallet = {
        switchAccount(i: number) {
          state.index = i;
          save();
          emit("accountsChanged", current());
        },
        setChain(id: string) {
          state.chainId = id;
          save();
          emit("chainChanged", id);
        },
        revoke() {
          state.authorized = false;
          save();
          emit("accountsChanged", []);
        },
        rejectNext(m: string) {
          state.reject.add(m);
        },
      };
      // EIP-6963 discovery, which wagmi uses to find installed wallets.
      const detail = Object.freeze({
        info: {
          uuid: "00000000-0000-4000-8000-000000000e2e",
          name: "MetaMask",
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E",
          rdns: "io.metamask",
        },
        provider,
      });
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    {
      addresses: accounts.map((a) => a.address),
      chainIdHex: `0x${chainId.toString(16)}`,
    },
  );
  const ctl = (page: Page, js: string) => page.evaluate(js);
  const wallet: TestWallet = {
    address: accounts[0]!.address,
    addresses: accounts.map((a) => a.address),
    signRequests,
    switchAccount: (page, i) => ctl(page, `window.__e2eWallet.switchAccount(${i})`).then(() => {}),
    setChain: (page, id) =>
      ctl(page, `window.__e2eWallet.setChain("0x${id.toString(16)}")`).then(() => {}),
    revoke: (page) => ctl(page, "window.__e2eWallet.revoke()").then(() => {}),
    rejectNext: (page, m) =>
      ctl(page, `window.__e2eWallet.rejectNext(${JSON.stringify(m)})`).then(() => {}),
  };
  return Object.assign(accounts[0]!, wallet);
}
