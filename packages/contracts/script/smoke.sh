#!/usr/bin/env bash
# Real-USDC smoke test for the Phase 1 vault on Arc testnet.
#
# Uses `cast send` rather than `forge script`: forge's local EVM can't execute Arc USDC transfers
# (they call the native precompile 0x1800…0001), so USDC-moving forge scripts fail in pre-execution.
#
# Usage (from packages/contracts, DEPLOYER_PRIVATE_KEY exported; the key is never printed):
#   script/smoke.sh fund 5        # approve + deposit 5 USDC into the smoke vault
#   script/smoke.sh register      # register the payee (starts the 2-minute cooldown)
#   script/smoke.sh pay           # propose + execute a 1 USDC round; also shows an over-cap proposal reverting
# Env: SMOKE_PAYEE (default: the deployer, so the funds come back), ARC_RPC_URL.
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?export DEPLOYER_PRIVATE_KEY from the root .env}"
RPC="${ARC_RPC_URL:-https://rpc.testnet.arc.io}"
EXPLORER="https://explorer.testnet.arc.io"
USDC=0x3600000000000000000000000000000000000000
DEPLOYMENTS="../shared/src/deployments.json"
VAULT=$(node -p "require('./$DEPLOYMENTS')['arc-testnet'].smokeVault")
[[ "$VAULT" == 0x* ]] || { echo "no smokeVault in $DEPLOYMENTS; run CreateVault.s.sol first" >&2; exit 1; }
DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")
PAYEE="${SMOKE_PAYEE:-$DEPLOYER}"
CONTRIBUTOR=$(cast keccak "smoke-contributor-1")
PAYOUT_T="(bytes32,bytes32,address,uint256,bytes32)"

send() {
  local hash
  hash=$(cast send --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json "$@" | node -pe 'JSON.parse(require("fs").readFileSync(0)).transactionHash')
  echo "  tx $EXPLORER/tx/$hash"
}

ZERO32=0x0000000000000000000000000000000000000000000000000000000000000000

# expect_revert <error signature> <cast call args...>: passes only if the call reverts with that custom error.
expect_revert() {
  local sel out
  sel=$(cast sig "$1"); shift
  if out=$(cast call --rpc-url "$RPC" --from "$DEPLOYER" "$@" 2>&1); then
    echo "  UNEXPECTED: call succeeded" >&2; exit 1
  fi
  [[ "$out" == *"$sel"* ]] || { echo "  UNEXPECTED revert (wanted $sel): $out" >&2; exit 1; }
  echo "  reverted with expected error ($sel)"
}

usdc_of() { cast call --rpc-url "$RPC" "$USDC" "balanceOf(address)(uint256)" "$1" | awk '{print $1}'; }

case "${1:-}" in
  fund)
    amount=$(( ${2:-5} * 1000000 ))
    echo "approve + deposit $amount (6-dec) into $VAULT"
    send "$USDC" "approve(address,uint256)" "$VAULT" "$amount"
    send "$VAULT" "deposit(uint256)" "$amount"
    echo "vault balance: $(usdc_of "$VAULT")"
    ;;
  register)
    echo "registerPayee($CONTRIBUTOR, $PAYEE)"
    send "$VAULT" "registerPayee(bytes32,address)" "$CONTRIBUTOR" "$PAYEE"
    cast call --rpc-url "$RPC" "$VAULT" "payeeOf(bytes32)((address,uint64))" "$CONTRIBUTOR"
    ;;
  pay)
    program=$(cast call --rpc-url "$RPC" "$VAULT" "programId()(bytes32)")
    round=$(cast keccak "smoke-round-$(date +%s)")
    payout_id=$(cast keccak "$(cast abi-encode 'f(bytes32,bytes32,bytes32)' "$program" "$round" "$CONTRIBUTOR")")
    decision=$(cast keccak "smoke-decision")

    echo "guardrail check: proposing 3 USDC (> maxPerPayout 2 USDC) must revert"
    expect_revert "PayoutTooLarge(bytes32,uint256,uint256)" "$VAULT" \
      "proposeRound(bytes32,${PAYOUT_T}[],bytes32)" "$round" \
      "[($payout_id,$CONTRIBUTOR,$PAYEE,3000000,$decision)]" "$ZERO32"

    before=$(usdc_of "$PAYEE")
    echo "round $round: 1 USDC to $PAYEE"
    send "$VAULT" "proposeRound(bytes32,${PAYOUT_T}[],bytes32)" "$round" \
      "[($payout_id,$CONTRIBUTOR,$PAYEE,1000000,$decision)]" "$decision"
    send "$VAULT" "executeRound(bytes32)" "$round"
    after=$(usdc_of "$PAYEE")
    echo "payee USDC: $before -> $after (gas is also paid in USDC when payee = deployer)"
    echo "paid[$payout_id] = $(cast call --rpc-url "$RPC" "$VAULT" "paid(bytes32)(bool)" "$payout_id")"

    echo "idempotency check: re-executing the round must revert"
    expect_revert "RoundNotExecutable(bytes32)" "$VAULT" "executeRound(bytes32)" "$round"
    echo "vault balance: $(usdc_of "$VAULT")"
    ;;
  *)
    echo "usage: $0 fund [usdc] | register | pay" >&2; exit 1 ;;
esac
