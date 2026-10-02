/**
 * A real EIP-1193 wallet for Playwright, backed by a testnet private key on the Node side. It's announced through
 * EIP-6963 as "QA Wallet" so ConnectKit lists it like any browser wallet. Signatures and transactions are real
 * (Arc testnet). The test can make the next request of a given method fail as "user rejected" (code 4001) and can
 * put the wallet on the wrong network.
 */
import type { Page } from "@playwright/test";
import { arcTestnet } from "@misthos/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  type Hex,
  type TransactionRequest,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface QaWallet {
  address: Hex;
  chainId: number;
  rejectNext(method: string): void;
  setChain(page: Page, id: number): Promise<void>;
  sent: Hex[];
}

const pub = createPublicClient({ chain: arcTestnet, transport: http() });

export async function installWallet(
  page: Page,
  key: Hex,
  opts: { chainId?: number; authorized?: boolean } = {},
): Promise<QaWallet> {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const reject = new Set<string>();
  let authorized = opts.authorized ?? false;
  const state: QaWallet = {
    address: account.address,
    chainId: opts.chainId ?? arcTestnet.id,
    sent: [],
    rejectNext: (m) => void reject.add(m),
    async setChain(p, id) {
      state.chainId = id;
      await p.evaluate(`window.__qaEmit("chainChanged", "${numberToHex(id)}")`);
    },
  };
  const userRejected = (method: string) => ({
    error: { code: 4001, message: `User rejected the request (${method}).` },
  });

  await page.exposeFunction("__qaRequest", async (raw: string) => {
    const { method, params = [] } = JSON.parse(raw) as { method: string; params?: unknown[] };
    try {
      if (reject.has(method)) {
        reject.delete(method);
        return JSON.stringify(userRejected(method));
      }
      switch (method) {
        case "eth_requestAccounts":
          authorized = true;
          return JSON.stringify({ result: [account.address] });
        case "eth_accounts":
          // Like a real wallet: no accounts until the site has been approved once.
          return JSON.stringify({ result: authorized ? [account.address] : [] });
        case "eth_chainId":
          return JSON.stringify({ result: numberToHex(state.chainId) });
        case "net_version":
          return JSON.stringify({ result: String(state.chainId) });
        case "wallet_switchEthereumChain": {
          const id = Number((params[0] as { chainId: string }).chainId);
          if (id !== arcTestnet.id)
            return JSON.stringify({ error: { code: 4902, message: "Unrecognized chain." } });
          state.chainId = id;
          await page.evaluate(`window.__qaEmit("chainChanged", "${numberToHex(id)}")`);
          return JSON.stringify({ result: null });
        }
        case "wallet_addEthereumChain":
          return JSON.stringify({ result: null });
        case "wallet_requestPermissions":
          authorized = true;
          return JSON.stringify({ result: [{ parentCapability: "eth_accounts" }] });
        case "wallet_getPermissions":
          return JSON.stringify({
            result: authorized ? [{ parentCapability: "eth_accounts" }] : [],
          });
        case "personal_sign": {
          const [msg] = params as [Hex];
          return JSON.stringify({ result: await account.signMessage({ message: { raw: msg } }) });
        }
        case "eth_signTypedData_v4": {
          const [, data] = params as [string, string];
          return JSON.stringify({ result: await account.signTypedData(JSON.parse(data)) });
        }
        case "eth_sendTransaction": {
          if (state.chainId !== arcTestnet.id)
            return JSON.stringify({
              error: { code: 4901, message: "Wallet is on another network." },
            });
          const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
          const hash = await wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
          } as TransactionRequest as never);
          state.sent.push(hash);
          return JSON.stringify({ result: hash });
        }
        default:
          return JSON.stringify({
            result: await pub.request({ method: method as never, params: params as never }),
          });
      }
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      return JSON.stringify({
        error: { code: err.code ?? -32603, message: err.shortMessage ?? err.message ?? "error" },
      });
    }
  });

  // Plain JS text: functions serialized by Playwright would carry tsx's __name() helper, which the page doesn't have.
  await page.addInitScript(`(() => {
    const listeners = {};
    const provider = {
      isQaWallet: true,
      // ConnectKit treats an announced io.metamask provider as an installed browser wallet, like the real extension.
      isMetaMask: true,
      async request({ method, params }) {
        const out = JSON.parse(await window.__qaRequest(JSON.stringify({ method, params })));
        if (out.error) throw Object.assign(new Error(out.error.message), { code: out.error.code });
        return out.result;
      },
      on(e, f) { (listeners[e] = listeners[e] || []).push(f); return provider; },
      removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); return provider; },
    };
    window.__qaEmit = (e, d) => (listeners[e] || []).forEach((f) => f(d));
    const info = {
      uuid: "6f2c7c1e-0c4b-4d55-9c0e-6a6f0c9a7b11",
      name: "MetaMask",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23444'/%3E%3C/svg%3E",
      rdns: "io.metamask",
    };
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    window.ethereum = provider;
  })();`);
  return state;
}
