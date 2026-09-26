import pino from "pino";
import { getChainConfig } from "@misthos/shared";

const log = pino({ name: "misthos-worker", redact: ["*.apiKey", "*.secret", "*.token"] });

// Job queue (pg-boss), agent pipeline and round jobs arrive in Phases 3–4.
const chain = getChainConfig();
log.info({ chain: chain.key, chainId: chain.chain.id }, "worker booted (no jobs registered yet)");
