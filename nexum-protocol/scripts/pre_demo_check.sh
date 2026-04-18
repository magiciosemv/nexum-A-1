#!/usr/bin/env bash
# Nexum Protocol — Pre-Demo Checklist
# Run before demo to verify all components are ready
set -uo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    echo "  [PASS] $label"
    ((PASS++))
  else
    echo "  [FAIL] $label"
    ((FAIL++))
  fi
}

echo "=== Nexum Protocol — Pre-Demo Checklist ==="
echo ""

echo "1. Development Tools"
check "Node.js" "command -v node"
check "npm" "command -v npm"
check "solana CLI" "command -v solana"
check "anchor CLI" "command -v anchor"
check "circom" "command -v circom"
check "snarkjs" "command -v snarkjs"

echo ""
echo "2. Compiled Artifacts"
check "nexum_pool.so" "test -f target/deploy/nexum_pool.so"
check "zk_verifier.so" "test -f target/deploy/zk_verifier.so"
check "audit_gate.so" "test -f target/deploy/audit_gate.so"
check "nexum_pool IDL" "test -f target/idl/nexum_pool.json"
check "zk_verifier IDL" "test -f target/idl/zk_verifier.json"
check "audit_gate IDL" "test -f target/idl/audit_gate.json"

echo ""
echo "3. ZK Circuit Artifacts"
check "Circuit WASM" "test -f circuits/build/balance_transition_js/balance_transition.wasm"
check "Proving key (zkey)" "test -f circuits/keys/circuit_0001.zkey"
check "Verification key" "test -f circuits/keys/verification_key.json"

echo ""
echo "4. SDK"
check "SDK compiled" "test -f sdk/dist/index.js"
check "SDK tests" "cd sdk && timeout 60 npx jest --passWithNoTests --runInBand 2>/dev/null"

echo ""
echo "5. Network"
check "Devnet RPC" "curl -s -o /dev/null -w '%{http_code}' https://api.devnet.solana.com -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}' | grep -q 200"
check "Solana keypair" "test -f ~/.config/solana/id.json"
check "Devnet balance" "solana balance --url devnet 2>/dev/null | grep -qv '0 SOL'"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo "Fix the failing checks before demo."
  exit 1
else
  echo "All checks passed! Ready for demo."
  exit 0
fi
