/**
 * Nexum Protocol — End-to-End Settlement Test
 *
 * Tests the complete flow: key generation → encryption → settlement
 * This test validates the SDK pipeline without requiring a running validator.
 * For on-chain integration, use `anchor test` with a local validator.
 */
import {
  encrypt,
  secureRandom,
  serializeCiphertext,
  deserializeCiphertext,
  buf2hex,
} from "../../sdk/src/crypto/elgamal";
import {
  deriveKeyPairFromSeed,
  derivePublicKey,
} from "../../sdk/src/crypto/keys";
import { splitU64, combineHiLo } from "../../sdk/src/crypto/utils";
import {
  buildBSGSTable,
  bsgsDecrypt,
} from "../../sdk/src/crypto/bsgs";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANSFER_AMOUNT = 1_000_000n;
const SENDER_INITIAL = 10_000_000n;
const RECEIVER_INITIAL = 5_000_000n;

describe("Nexum Protocol — E2E Settlement Flow", () => {
  // Build BSGS table once for all tests to avoid memory issues
  let bsgsTable: ReturnType<typeof buildBSGSTable>;
  before(function() {
    this.timeout(60000);
    bsgsTable = buildBSGSTable();
  });

  describe("Key Generation", () => {
    it("should generate sender and receiver keypairs", () => {
      const sender = deriveKeyPairFromSeed("a1".repeat(32));
      const receiver = deriveKeyPairFromSeed("b2".repeat(32));

      expect(sender.sk > 0n).to.be.true;
      expect(receiver.sk > 0n).to.be.true;
      expect(sender.pk.x).to.not.be.undefined;
      expect(receiver.pk.x).to.not.be.undefined;
      expect(sender.pk.x).to.not.equal(receiver.pk.x);
    });
  });

  describe("Balance Encryption (hi/lo split)", () => {
    it("should correctly split and recombine 64-bit amounts", () => {
      const testValues = [
        0n, 1n, 1000n, TRANSFER_AMOUNT, SENDER_INITIAL,
        (1n << 32n) - 1n,     // max lo
        1n << 32n,             // smallest with hi > 0
        (1n << 64n) - 1n,     // max uint64
      ];

      for (const balance of testValues) {
        const { lo, hi } = splitU64(balance);
        expect(lo < (1n << 32n)).to.be.true;
        expect(hi < (1n << 32n)).to.be.true;
        expect(combineHiLo(hi, lo)).to.equal(balance);
      }

      // Verify encrypt/serialize round-trip for lo parts (hi=0 cases)
      const pk = derivePublicKey(secureRandom());
      for (const val of [0n, 1n, 1000n, TRANSFER_AMOUNT, SENDER_INITIAL]) {
        const { lo } = splitU64(val);
        const { ct } = encrypt(lo, pk);
        const buf = serializeCiphertext(ct);
        expect(buf.length).to.equal(128);
        const ct2 = deserializeCiphertext(buf);
        expect(ct2.C1.x).to.equal(ct.C1.x);
      }
    });
  });

  describe("Settlement Math", () => {
    it("should compute balance transitions correctly", () => {
      const senderSk = deriveKeyPairFromSeed("a1".repeat(32)).sk;
      const senderPk = derivePublicKey(senderSk);
      const receiverSk = deriveKeyPairFromSeed("b2".repeat(32)).sk;
      const receiverPk = derivePublicKey(receiverSk);

      const senderBalance = splitU64(SENDER_INITIAL);
      const receiverBalance = splitU64(RECEIVER_INITIAL);

      expect(SENDER_INITIAL >= TRANSFER_AMOUNT).to.be.true;

      const newSenderBalance = SENDER_INITIAL - TRANSFER_AMOUNT;
      const newReceiverBalance = RECEIVER_INITIAL + TRANSFER_AMOUNT;

      expect(newSenderBalance + newReceiverBalance).to.equal(
        SENDER_INITIAL + RECEIVER_INITIAL
      );

      const r1 = secureRandom(), r2 = secureRandom(), r3 = secureRandom(), r4 = secureRandom();
      encrypt(senderBalance.lo, senderPk, r1);
      encrypt(senderBalance.hi, senderPk, r2);
      encrypt(receiverBalance.lo, receiverPk, r3);
      encrypt(receiverBalance.hi, receiverPk, r4);

      const newSender = splitU64(newSenderBalance);
      const newReceiver = splitU64(newReceiverBalance);

      const r5 = secureRandom(), r6 = secureRandom(), r7 = secureRandom(), r8 = secureRandom();
      const ctNewSenderLo = encrypt(newSender.lo, senderPk, r5);
      const ctNewSenderHi = encrypt(newSender.hi, senderPk, r6);
      const ctNewReceiverLo = encrypt(newReceiver.lo, receiverPk, r7);
      const ctNewReceiverHi = encrypt(newReceiver.hi, receiverPk, r8);



      const decNewSenderLo = bsgsDecrypt(ctNewSenderLo.ct, senderSk, bsgsTable);
      const decNewSenderHi = bsgsDecrypt(ctNewSenderHi.ct, senderSk, bsgsTable);
      const decNewReceiverLo = bsgsDecrypt(ctNewReceiverLo.ct, receiverSk, bsgsTable);
      const decNewReceiverHi = bsgsDecrypt(ctNewReceiverHi.ct, receiverSk, bsgsTable);

      expect(combineHiLo(decNewSenderHi, decNewSenderLo)).to.equal(newSenderBalance);
      expect(combineHiLo(decNewReceiverHi, decNewReceiverLo)).to.equal(newReceiverBalance);
    });
  });

  describe("Ciphertext Serialization", () => {
    it("should serialize/deserialize all ciphertexts in settlement flow", () => {
      const pk = derivePublicKey(secureRandom());

      for (let i = 0; i < 5; i++) {
        const m = BigInt(Math.floor(Math.random() * 0x100000000));
        const { ct } = encrypt(m, pk);

        const buf = serializeCiphertext(ct);
        expect(buf.length).to.equal(128);

        const ct2 = deserializeCiphertext(buf);
        expect(ct2.C1.x).to.equal(ct.C1.x);
        expect(ct2.C1.y).to.equal(ct.C1.y);
        expect(ct2.C2.x).to.equal(ct.C2.x);
        expect(ct2.C2.y).to.equal(ct.C2.y);
      }
    });
  });

  describe("Program IDL Validation", () => {
    it("should have valid IDL for all three programs", () => {
      const projectRoot = join(__dirname, "../..");

      for (const name of ["nexum_pool", "zk_verifier", "audit_gate"]) {
        const idlPath = join(projectRoot, "target/idl", `${name}.json`);
        const idl: any = JSON.parse(readFileSync(idlPath, "utf8"));

        expect(idl.metadata.name).to.not.be.undefined;
        expect(idl.instructions.length).to.be.greaterThan(0);

        for (const ix of idl.instructions) {
          expect(ix.name).to.not.be.undefined;
          expect(Array.isArray(ix.accounts)).to.be.true;
        }

        console.log(`  ${name}: ${idl.instructions.map((i: any) => i.name).join(", ")}`);
      }
    });

    it("settle_atomic should have correct account structure", () => {
      const projectRoot = join(__dirname, "../..");
      const idl: any = JSON.parse(
        readFileSync(join(projectRoot, "target/idl/nexum_pool.json"), "utf8")
      );

      const settleIx = idl.instructions.find(
        (ix: any) => ix.name === "settle_atomic"
      );
      expect(settleIx).to.not.be.undefined;

      const accounts = settleIx.accounts;
      expect(accounts.length).to.equal(7);

      const accountNames = accounts.map((a: any) => a.name);
      expect(accountNames).to.include("ledger_a");
      expect(accountNames).to.include("ledger_b");
      expect(accountNames).to.include("settlement_record");
      expect(accountNames).to.include("zk_verifier");
      expect(accountNames).to.include("fee_payer");

      const args = settleIx.args;
      expect(args.length).to.equal(1);
      expect(args[0].name).to.equal("params");
    });
  });

  describe("Full Settlement Pipeline (Off-Chain)", () => {
    it("should execute the complete settlement flow end-to-end", async () => {
      console.log("=== Nexum Protocol E2E Settlement Simulation ===\n");

      // 1. Generate keys
      const sender = deriveKeyPairFromSeed("a1".repeat(32));
      const receiver = deriveKeyPairFromSeed("b2".repeat(32));
      console.log("1. Keys generated");

      // 2. Build BSGS table
      console.log("2. Building BSGS decryption table...");

      console.log("   BSGS table built: " + bsgsTable.table.size + " entries\n");

      // 3. Encrypt initial balances
      console.log("3. Encrypting initial balances...");
      const senderBal = splitU64(SENDER_INITIAL);
      const receiverBal = splitU64(RECEIVER_INITIAL);

      const ctSenderLo = encrypt(senderBal.lo, sender.pk);
      const ctSenderHi = encrypt(senderBal.hi, sender.pk);
      const ctReceiverLo = encrypt(receiverBal.lo, receiver.pk);
      const ctReceiverHi = encrypt(receiverBal.hi, receiver.pk);
      console.log("   Sender: " + SENDER_INITIAL + " (lo=" + senderBal.lo + ", hi=" + senderBal.hi + ")");
      console.log("   Receiver: " + RECEIVER_INITIAL + "\n");

      // 4. Verify decryption
      console.log("4. Verifying decryption...");
      const senderDecrypted = combineHiLo(
        bsgsDecrypt(ctSenderHi.ct, sender.sk, bsgsTable),
        bsgsDecrypt(ctSenderLo.ct, sender.sk, bsgsTable)
      );
      const receiverDecrypted = combineHiLo(
        bsgsDecrypt(ctReceiverHi.ct, receiver.sk, bsgsTable),
        bsgsDecrypt(ctReceiverLo.ct, receiver.sk, bsgsTable)
      );
      expect(senderDecrypted).to.equal(SENDER_INITIAL);
      expect(receiverDecrypted).to.equal(RECEIVER_INITIAL);
      console.log("   Sender: " + senderDecrypted + " [OK]");
      console.log("   Receiver: " + receiverDecrypted + " [OK]\n");

      // 5. Compute balance transition
      console.log("5. Computing balance transition...");
      console.log("   Transfer: " + TRANSFER_AMOUNT);
      const newSenderBal = SENDER_INITIAL - TRANSFER_AMOUNT;
      const newReceiverBal = RECEIVER_INITIAL + TRANSFER_AMOUNT;
      expect(newSenderBal + newReceiverBal).to.equal(SENDER_INITIAL + RECEIVER_INITIAL);
      console.log("   New sender: " + newSenderBal);
      console.log("   New receiver: " + newReceiverBal);
      console.log("   Conservation: " + (newSenderBal + newReceiverBal) + " == " + (SENDER_INITIAL + RECEIVER_INITIAL) + " [OK]\n");

      // 6. Encrypt new balances and verify
      console.log("6. Encrypting new balances...");
      const newSender = splitU64(newSenderBal);
      const newReceiver = splitU64(newReceiverBal);

      const ctNewSenderLo = encrypt(newSender.lo, sender.pk);
      const ctNewSenderHi = encrypt(newSender.hi, sender.pk);
      const ctNewReceiverLo = encrypt(newReceiver.lo, receiver.pk);
      const ctNewReceiverHi = encrypt(newReceiver.hi, receiver.pk);

      const decNewSender = combineHiLo(
        bsgsDecrypt(ctNewSenderHi.ct, sender.sk, bsgsTable),
        bsgsDecrypt(ctNewSenderLo.ct, sender.sk, bsgsTable)
      );
      const decNewReceiver = combineHiLo(
        bsgsDecrypt(ctNewReceiverHi.ct, receiver.sk, bsgsTable),
        bsgsDecrypt(ctNewReceiverLo.ct, receiver.sk, bsgsTable)
      );
      expect(decNewSender).to.equal(newSenderBal);
      expect(decNewReceiver).to.equal(newReceiverBal);
      console.log("   New sender decrypted: " + decNewSender + " [OK]");
      console.log("   New receiver decrypted: " + decNewReceiver + " [OK]\n");

      // 7. Serialize for on-chain
      console.log("7. Serializing ciphertexts...");
      expect(serializeCiphertext(ctNewSenderLo.ct).length).to.equal(128);
      expect(serializeCiphertext(ctNewSenderHi.ct).length).to.equal(128);
      expect(serializeCiphertext(ctNewReceiverLo.ct).length).to.equal(128);
      expect(serializeCiphertext(ctNewReceiverHi.ct).length).to.equal(128);
      console.log("   4 ciphertexts x 128 bytes [OK]\n");

      console.log("=== E2E Settlement Simulation Complete ===");
    }, 60000);
  });
});
