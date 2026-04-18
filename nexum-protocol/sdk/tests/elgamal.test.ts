import {
  BabyJub,
  ORDER,
  encrypt,
  serializeCiphertext,
  deserializeCiphertext,
  secureRandom,
} from "../src/crypto/elgamal";
import { derivePublicKey, deriveKeyPairFromSeed } from "../src/crypto/keys";
import { splitU64, combineHiLo } from "../src/crypto/utils";

const G = BabyJub.ExtendedPoint.BASE;

describe("Baby Jubjub ElGamal", () => {
  describe("key derivation", () => {
    it("should derive a valid public key from secret key", () => {
      const sk = 12345n;
      const pk = derivePublicKey(sk);
      // Public key must be a valid curve point
      const point = BabyJub.ExtendedPoint.fromAffine(pk);
      expect(point).toBeDefined();
      // pk = sk * G
      const expected = G.multiply(sk).toAffine();
      expect(pk.x).toBe(expected.x);
      expect(pk.y).toBe(expected.y);
    });

    it("should derive consistent keypair from seed", () => {
      const seed = "ab".repeat(32); // 64 hex chars
      const { sk, pk } = deriveKeyPairFromSeed(seed);
      expect(sk).toBeGreaterThan(0n);
      expect(sk).toBeLessThan(ORDER);
      // Derive again, should get same result
      const { sk: sk2, pk: pk2 } = deriveKeyPairFromSeed(seed);
      expect(sk).toBe(sk2);
      expect(pk.x).toBe(pk2.x);
      expect(pk.y).toBe(pk2.y);
    });
  });

  describe("encryption / decryption consistency", () => {
    it("should encrypt and the ciphertext should be on curve", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      const m = 1000n;
      const { ct, r } = encrypt(m, pk);

      // C1 = r * G
      const C1 = BabyJub.ExtendedPoint.fromAffine(ct.C1);
      const expectedC1 = G.multiply(r).toAffine();
      expect(C1.toAffine().x).toBe(expectedC1.x);

      // C2 = m*G + r*pk
      const pkPoint = BabyJub.ExtendedPoint.fromAffine(pk);
      const expectedC2 = G.multiply(m).add(pkPoint.multiply(r)).toAffine();
      expect(ct.C2.x).toBe(expectedC2.x);
      expect(ct.C2.y).toBe(expectedC2.y);
    });

    it("should decrypt correctly using manual computation", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      const m = 42424n;
      const { ct } = encrypt(m, pk);

      // Decrypt: m*G = C2 - sk*C1
      const C1 = BabyJub.ExtendedPoint.fromAffine(ct.C1);
      const C2 = BabyJub.ExtendedPoint.fromAffine(ct.C2);
      const mG = C2.subtract(C1.multiply(sk)).toAffine();

      // Verify m*G == expected
      const expectedMG = G.multiply(m).toAffine();
      expect(mG.x).toBe(expectedMG.x);
      expect(mG.y).toBe(expectedMG.y);
    });

    it("should encrypt with deterministic r", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      const m = 999n;
      const r = 42n;

      const { ct: ct1 } = encrypt(m, pk, r);
      const { ct: ct2 } = encrypt(m, pk, r);

      // Same r → same ciphertext
      expect(ct1.C1.x).toBe(ct2.C1.x);
      expect(ct1.C2.x).toBe(ct2.C2.x);
    });

    it("should reject out-of-range plaintexts", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      expect(() => encrypt(-1n, pk)).toThrow("out of range");
      expect(() => encrypt(1n << 32n, pk)).toThrow("out of range");
    });
  });

  describe("serialization round-trip", () => {
    it("should serialize and deserialize ciphertext correctly", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      const m = 12345n;
      const { ct } = encrypt(m, pk);

      const buf = serializeCiphertext(ct);
      expect(buf.length).toBe(128);

      const ct2 = deserializeCiphertext(buf);
      expect(ct2.C1.x).toBe(ct.C1.x);
      expect(ct2.C1.y).toBe(ct.C1.y);
      expect(ct2.C2.x).toBe(ct.C2.x);
      expect(ct2.C2.y).toBe(ct.C2.y);
    });

    it("should reject wrong-length buffer", () => {
      expect(() => deserializeCiphertext(new Uint8Array(64))).toThrow(
        "Invalid ciphertext length"
      );
    });
  });

  describe("hi/lo split for 64-bit balances", () => {
    it("should encrypt hi and lo parts independently and decrypt", () => {
      const sk = secureRandom();
      const pk = derivePublicKey(sk);
      const balance = (999n << 32n) + 12345n; // 64-bit amount
      const { lo, hi } = splitU64(balance);

      expect(lo).toBe(12345n);
      expect(hi).toBe(999n);

      const { ct: ctLo } = encrypt(lo, pk);
      const { ct: ctHi } = encrypt(hi, pk);

      // Verify decrypt works for both parts
      const C1Lo = BabyJub.ExtendedPoint.fromAffine(ctLo.C1);
      const C2Lo = BabyJub.ExtendedPoint.fromAffine(ctLo.C2);
      const mGLo = C2Lo.subtract(C1Lo.multiply(sk)).toAffine();
      expect(mGLo.x).toBe(G.multiply(lo).toAffine().x);

      const C1Hi = BabyJub.ExtendedPoint.fromAffine(ctHi.C1);
      const C2Hi = BabyJub.ExtendedPoint.fromAffine(ctHi.C2);
      const mGHi = C2Hi.subtract(C1Hi.multiply(sk)).toAffine();
      expect(mGHi.x).toBe(G.multiply(hi).toAffine().x);

      // Round-trip
      expect(combineHiLo(hi, lo)).toBe(balance);
    });
  });
});
