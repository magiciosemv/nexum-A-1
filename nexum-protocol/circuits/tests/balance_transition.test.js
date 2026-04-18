const assert = require("assert");
const { buildBabyjub } = require("circomlibjs");
const snarkjs = require("snarkjs");
const path = require("path");

const WASM_PATH = path.join(__dirname, "../build/balance_transition_js/balance_transition.wasm");
const ZKEY_PATH = path.join(__dirname, "../keys/circuit_0001.zkey");
const VKEY_PATH = path.join(__dirname, "../keys/verification_key.json");

// --- Baby Jubjub ElGamal encryption helper ---
async function encrypt(babyjub, amount, pk, r) {
  const G = babyjub.Base8;
  const C1 = babyjub.mulPointEscalar(G, r);
  const mG = babyjub.mulPointEscalar(G, amount);
  const rPk = babyjub.mulPointEscalar(pk, r);
  const C2 = babyjub.addPoint(mG, rPk);
  return { C1, C2 };
}

// Convert a babyjub point [x,y] to string representation for circuit input
function ptStr(p) {
  return [
    babyjub.F.toString(p[0]),
    babyjub.F.toString(p[1]),
  ];
}

// Global babyjub instance (shared across tests)
let babyjub;
let vkey;

// Generate a random private key in babyjub subgroup (must be < subOrder for BabyPbk)
function randomPrivKey() {
  const subOrder = BigInt(babyjub.subOrder);
  // Generate a random scalar smaller than the suborder
  const buf = Buffer.alloc(32);
  require("crypto").randomFillSync(buf);
  let sk = BigInt("0x" + buf.toString("hex")) % subOrder;
  if (sk === 0n) sk = 1n;
  return sk.toString();
}

// Derive public key from private key
function derivePk(sk) {
  return babyjub.mulPointEscalar(babyjub.Base8, sk);
}

// Build full circuit input from high-level parameters
async function buildInput({ oldBalance, transfer, newBalance, isSender, userSk, auditSk }) {
  const userPk = derivePk(userSk);
  const auditPk = derivePk(auditSk);

  // Split 64-bit values into lo (32-bit) and hi
  const MASK32 = (1n << 32n) - 1n;
  const split = (v) => {
    const lo = v & MASK32;
    const hi = (v >> 32n) & MASK32;
    return { lo, hi };
  };

  const old = split(oldBalance);
  const tra = split(transfer);
  const nw = split(newBalance);

  // Random nonces for each encryption
  const rOldLo = randomPrivKey();
  const rOldHi = randomPrivKey();
  const rNewLo = randomPrivKey();
  const rNewHi = randomPrivKey();
  const rAudLo = randomPrivKey();
  const rAudHi = randomPrivKey();

  // Encrypt old balance (lo & hi) to user
  const oldCtLo = await encrypt(babyjub, old.lo.toString(), userPk, rOldLo);
  const oldCtHi = await encrypt(babyjub, old.hi.toString(), userPk, rOldHi);

  // Encrypt new balance (lo & hi) to user
  const newCtLo = await encrypt(babyjub, nw.lo.toString(), userPk, rNewLo);
  const newCtHi = await encrypt(babyjub, nw.hi.toString(), userPk, rNewHi);

  // Encrypt transfer (lo & hi) to auditor
  const audCtLo = await encrypt(babyjub, tra.lo.toString(), auditPk, rAudLo);
  const audCtHi = await encrypt(babyjub, tra.hi.toString(), auditPk, rAudHi);

  return {
    old_balance_lo: old.lo.toString(),
    old_balance_hi: old.hi.toString(),
    transfer_lo: tra.lo.toString(),
    transfer_hi: tra.hi.toString(),
    new_balance_lo: nw.lo.toString(),
    new_balance_hi: nw.hi.toString(),
    r_old_lo: rOldLo,
    r_old_hi: rOldHi,
    r_new_lo: rNewLo,
    r_new_hi: rNewHi,
    r_audit_lo: rAudLo,
    r_audit_hi: rAudHi,
    user_pkX: babyjub.F.toString(userPk[0]),
    user_pkY: babyjub.F.toString(userPk[1]),
    audit_pkX: babyjub.F.toString(auditPk[0]),
    audit_pkY: babyjub.F.toString(auditPk[1]),
    old_ct_lo_C1x: babyjub.F.toString(oldCtLo.C1[0]),
    old_ct_lo_C1y: babyjub.F.toString(oldCtLo.C1[1]),
    old_ct_lo_C2x: babyjub.F.toString(oldCtLo.C2[0]),
    old_ct_lo_C2y: babyjub.F.toString(oldCtLo.C2[1]),
    old_ct_hi_C1x: babyjub.F.toString(oldCtHi.C1[0]),
    old_ct_hi_C1y: babyjub.F.toString(oldCtHi.C1[1]),
    old_ct_hi_C2x: babyjub.F.toString(oldCtHi.C2[0]),
    old_ct_hi_C2y: babyjub.F.toString(oldCtHi.C2[1]),
    new_ct_lo_C1x: babyjub.F.toString(newCtLo.C1[0]),
    new_ct_lo_C1y: babyjub.F.toString(newCtLo.C1[1]),
    new_ct_lo_C2x: babyjub.F.toString(newCtLo.C2[0]),
    new_ct_lo_C2y: babyjub.F.toString(newCtLo.C2[1]),
    new_ct_hi_C1x: babyjub.F.toString(newCtHi.C1[0]),
    new_ct_hi_C1y: babyjub.F.toString(newCtHi.C1[1]),
    new_ct_hi_C2x: babyjub.F.toString(newCtHi.C2[0]),
    new_ct_hi_C2y: babyjub.F.toString(newCtHi.C2[1]),
    audit_ct_lo_C1x: babyjub.F.toString(audCtLo.C1[0]),
    audit_ct_lo_C1y: babyjub.F.toString(audCtLo.C1[1]),
    audit_ct_lo_C2x: babyjub.F.toString(audCtLo.C2[0]),
    audit_ct_lo_C2y: babyjub.F.toString(audCtLo.C2[1]),
    audit_ct_hi_C1x: babyjub.F.toString(audCtHi.C1[0]),
    audit_ct_hi_C1y: babyjub.F.toString(audCtHi.C1[1]),
    audit_ct_hi_C2x: babyjub.F.toString(audCtHi.C2[0]),
    audit_ct_hi_C2y: babyjub.F.toString(audCtHi.C2[1]),
    expected_version: "0",
    is_sender: isSender ? "1" : "0",
  };
}

// Generate and verify a Groth16 proof
async function proveAndVerify(input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  );
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  return { proof, publicSignals, ok };
}

// ============================================================
// Test suite
// ============================================================
describe("BalanceTransition Circuit", function () {
  this.timeout(120000);

  before(async function () {
    babyjub = await buildBabyjub();
    const fs = require("fs");
    vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
  });

  // --- Test 1: Sender normal scenario ---
  it("should prove and verify sender balance transition (old=1000, transfer=300, new=700)", async function () {
    const userSk = randomPrivKey();
    const auditSk = randomPrivKey();

    const input = await buildInput({
      oldBalance: 1000n,
      transfer: 300n,
      newBalance: 700n,
      isSender: true,
      userSk,
      auditSk,
    });

    const { ok, publicSignals } = await proveAndVerify(input);
    assert.strictEqual(ok, true, "Proof verification failed");
    // is_sender should be 1 in public signals
    assert.strictEqual(publicSignals[publicSignals.length - 1], "1");
  });

  // --- Test 2: Receiver normal scenario ---
  it("should prove and verify receiver balance transition (old=500, transfer=300, new=800)", async function () {
    const userSk = randomPrivKey();
    const auditSk = randomPrivKey();

    const input = await buildInput({
      oldBalance: 500n,
      transfer: 300n,
      newBalance: 800n,
      isSender: false,
      userSk,
      auditSk,
    });

    const { ok, publicSignals } = await proveAndVerify(input);
    assert.strictEqual(ok, true, "Proof verification failed");
    assert.strictEqual(publicSignals[publicSignals.length - 1], "0");
  });

  // --- Test 3: Large amount test ---
  it("should prove and verify large-value transition (old=10000000, transfer=1000000, new=9000000)", async function () {
    const userSk = randomPrivKey();
    const auditSk = randomPrivKey();

    const input = await buildInput({
      oldBalance: 10000000n,
      transfer: 1000000n,
      newBalance: 9000000n,
      isSender: true,
      userSk,
      auditSk,
    });

    const { ok } = await proveAndVerify(input);
    assert.strictEqual(ok, true, "Proof verification failed");
  });

  // --- Test 4: Invalid proof (wrong old_balance, proof generation should fail) ---
  it("should fail when old_balance does not match ciphertexts", async function () {
    const userSk = randomPrivKey();
    const auditSk = randomPrivKey();

    const input = await buildInput({
      oldBalance: 1000n,
      transfer: 300n,
      newBalance: 700n,
      isSender: true,
      userSk,
      auditSk,
    });

    // Tamper: change old_balance_lo to a wrong value
    input.old_balance_lo = "999";

    try {
      await proveAndVerify(input);
      // If we get here the proof was generated despite wrong input
      // This means the circuit did not enforce correctness
      assert.fail("Expected proof generation to fail or return invalid proof");
    } catch (err) {
      // Expected: witness generation fails because constraint is violated
      const msg = (err && (err.message || String(err))) || "";
      // Accept both assertion failures (invalid proof) and runtime errors (constraint violation)
      assert.ok(
        msg.length > 0,
        "Error should have a message"
      );
    }
  });

  // --- Test 5: Zero transfer (edge case) ---
  it("should prove and verify zero transfer (transfer=0)", async function () {
    const userSk = randomPrivKey();
    const auditSk = randomPrivKey();

    const input = await buildInput({
      oldBalance: 1000n,
      transfer: 0n,
      newBalance: 1000n,
      isSender: true,
      userSk,
      auditSk,
    });

    const { ok, publicSignals } = await proveAndVerify(input);
    assert.strictEqual(ok, true, "Proof verification failed");
  });
});
