import type { BrowserContext } from "@playwright/test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Inject a minimal EIP-1193 wallet (looks like MetaMask to ConnectKit) backed by a local viem key. Signing happens
 * in the test process; the page only ever sees signatures, as with a real extension.
 */
export async function injectWallet(context: BrowserContext, privateKey: Hex, chainId = 5042002) {
  const account = privateKeyToAccount(privateKey);
  await context.exposeFunction("__e2eSign", (data: Hex) =>
    account.signMessage({ message: { raw: data } }),
  );
  await context.addInitScript(
    ({ address, chainIdHex }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      // Like a real extension: no accounts are exposed until the site requests access.
      let authorized = false;
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
          switch (method) {
            case "eth_requestAccounts":
              authorized = true;
              return [address];
            case "eth_accounts":
              return authorized ? [address] : [];
            case "eth_chainId":
              return chainIdHex;
            case "net_version":
              return String(parseInt(chainIdHex, 16));
            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              return null;
            case "wallet_requestPermissions":
              authorized = true;
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_getPermissions":
              return authorized ? [{ parentCapability: "eth_accounts" }] : [];
            case "personal_sign":
              return (window as unknown as { __e2eSign: (d: string) => Promise<string> }).__e2eSign(
                params![0] as string,
              );
            default:
              throw Object.assign(new Error(`e2e wallet: unsupported ${method}`), { code: 4200 });
          }
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;
      // EIP-6963 discovery, which wagmi/ConnectKit use to detect installed wallets.
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
    { address: account.address, chainIdHex: `0x${chainId.toString(16)}` },
  );
  return account;
}
