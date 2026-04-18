#!/bin/bash
set -e

echo "=== Step 1: Install dependencies ==="
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "=== Step 2: Compile circuit ==="
circom src/balance_transition.circom \
  --r1cs --wasm --sym \
  -o build/ \
  --prime bn128

# Check constraint count
CONSTRAINTS=$(snarkjs r1cs info build/balance_transition.r1cs 2>&1 | grep "Constraints" | awk '{print $NF}')
echo "Constraint count: $CONSTRAINTS"
if [ "${CONSTRAINTS%%.*}" -gt 131072 ] 2>/dev/null; then
  echo "ERROR: Too many constraints! Need larger ptau."
  exit 1
fi

echo "=== Step 3: Phase 2 trusted setup ==="
PTAU="${PTAU_PATH:-$HOME/nexum-ptau/powersOfTau28_hez_final_17.ptau}"

if [ ! -f "$PTAU" ]; then
  echo "Downloading Powers of Tau (size 17)..."
  mkdir -p "$(dirname "$PTAU")"
  wget -q https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_17.ptau \
    -O "$PTAU"
fi

snarkjs groth16 setup \
  build/balance_transition.r1cs \
  "$PTAU" \
  keys/circuit_0000.zkey

snarkjs zkey contribute \
  keys/circuit_0000.zkey \
  keys/circuit_0001.zkey \
  --name="Nexum Hackathon Team" \
  -e="$(openssl rand -hex 64)" \
  -v

echo "=== Step 4: Export verification key ==="
snarkjs zkey export verificationkey \
  keys/circuit_0001.zkey \
  keys/verification_key.json

echo "=== Done ==="
echo "WASM:  build/balance_transition_js/balance_transition.wasm"
echo "ZKey:  keys/circuit_0001.zkey"
echo "VKey:  keys/verification_key.json"
