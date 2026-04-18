#!/usr/bin/env bash
# Nexum Protocol — Devnet Deployment Script
# Deploys all three programs to Solana Devnet
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Nexum Protocol — Devnet Deployment ==="
echo "Project dir: $PROJECT_DIR"

# Check for devnet URL
CLUSTER="${CLUSTER:-devnet}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"

echo "Cluster: $CLUSTER"
echo "RPC: $RPC_URL"

# Check solana CLI
if ! command -v solana &>/dev/null; then
  echo "ERROR: solana CLI not found. Install from https://docs.solana.com/cli/install-solana-cli-tools"
  exit 1
fi

# Check for deploy keypair
KEYPAIR="${HOME}/.config/solana/id.json"
if [ ! -f "$KEYPAIR" ]; then
  echo "ERROR: Solana keypair not found at $KEYPAIR"
  echo "Run: solana-keygen new"
  exit 1
fi

BALANCE=$(solana balance --url "$RPC_URL" | awk '{print $1}')
echo "Deployer balance: $BALANCE SOL"

if [[ "$(echo "$BALANCE" | awk '{print $1}')" == "0" ]]; then
  echo "ERROR: No SOL balance. Request airdrop:"
  echo "  solana airdrop 2 --url $RPC_URL"
  exit 1
fi

# Deploy programs
DEPLOY_DIR="$PROJECT_DIR/target/deploy"

for program in nexum_pool zk_verifier audit_gate; do
  SO_FILE="$DEPLOY_DIR/$program.so"
  if [ ! -f "$SO_FILE" ]; then
    echo "ERROR: $SO_FILE not found. Run anchor build first."
    exit 1
  fi
  echo ""
  echo "Deploying $program..."
  echo "  Size: $(ls -lh "$SO_FILE" | awk '{print $5}')"
  PROGRAM_ID=$(solana program deploy --url "$RPC_URL" "$SO_FILE" 2>&1 | grep "Program Id:" | awk '{print $NF}')
  if [ -n "$PROGRAM_ID" ]; then
    echo "  Program Id: $PROGRAM_ID"
  else
    echo "  WARNING: Deployment may have failed. Check output above."
  fi
done

echo ""
echo "=== Deployment Complete ==="
echo "Verify with: solana program show --url $RPC_URL <PROGRAM_ID>"
