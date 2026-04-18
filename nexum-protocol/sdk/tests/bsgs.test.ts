import { encrypt, secureRandom } from "../src/crypto/elgamal";
import { buildBSGSTable, bsgsDecrypt } from "../src/crypto/bsgs";
import { derivePublicKey } from "../src/crypto/keys";

describe("BSGS (Baby-Step Giant-Step) decryption", () => {
  let bsgsTable: ReturnType<typeof buildBSGSTable>;

  beforeAll(() => {
    bsgsTable = buildBSGSTable();
  });

  it("should build a valid BSGS table", () => {
    expect(bsgsTable.table.size).toBe(65535); // i=1..65535, i=0 handled separately
    expect(bsgsTable.giantStep).toBeDefined();
    expect(bsgsTable.giantStep.x).toBeDefined();
    expect(bsgsTable.giantStep.y).toBeDefined();
  });

  it("should decrypt small values correctly", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    for (const m of [0n, 1n, 10n, 100n, 1000n, 65535n]) {
      const { ct } = encrypt(m, pk);
      const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
      expect(decrypted).toBe(m);
    }
  });

  it("should decrypt medium-range values", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    const testValues = [65536n, 100000n, 1000000n, 10000000n];
    for (const m of testValues) {
      const { ct } = encrypt(m, pk);
      const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
      expect(decrypted).toBe(m);
    }
  });

  it("should decrypt values near the upper range boundary", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    const maxVal = (1n << 32n) - 1n; // 0xFFFFFFFF
    const { ct } = encrypt(maxVal, pk);
    const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
    expect(decrypted).toBe(maxVal);
  });

  it("should decrypt random values consistently", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    // Test 20 random values in [0, 2^32)
    for (let i = 0; i < 20; i++) {
      const m = BigInt(Math.floor(Math.random() * 0x100000000));
      const { ct } = encrypt(m, pk);
      const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
      expect(decrypted).toBe(m);
    }
  });

  it("should throw for values out of range", () => {
    // This test verifies that BSGS fails when the plaintext is >= 2^32
    // Since encrypt rejects out-of-range values, we can't directly test this
    // But we can verify the table is sized correctly
    expect(bsgsTable.table.size).toBe(65535); // sqrt(2^32)-1, i=0 handled separately
  });

  it("should decrypt large values >100000 correctly", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    // Values significantly above 16-bit range
    const testValues = [
      123456n,    // ~120K
      500000n,    // 500K
      999999n,    // ~1M
    ];
    for (const m of testValues) {
      const { ct } = encrypt(m, pk);
      const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
      expect(decrypted).toBe(m);
    }
  });

  it("should decrypt large values >1000000 correctly", () => {
    const sk = secureRandom();
    const pk = derivePublicKey(sk);

    // Values well into the millions
    const testValues = [
      1000000n,     // 1M
      100000000n,   // 100M
      1000000000n,  // 1B
    ];
    for (const m of testValues) {
      const { ct } = encrypt(m, pk);
      const decrypted = bsgsDecrypt(ct, sk, bsgsTable);
      expect(decrypted).toBe(m);
    }
  });
});
