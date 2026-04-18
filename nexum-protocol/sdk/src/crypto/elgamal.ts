import { twistedEdwards } from "@noble/curves/abstract/edwards";
import { Field } from "@noble/curves/abstract/modular";

// ── Baby Jubjub curve parameters ────────────────────────────────────────────
const Fp = Field(
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
);

export const BabyJub = twistedEdwards({
  a: Fp.create(168700n),
  d: Fp.create(168696n),
  Fp,
  n: 2736030358979909402780800718157159386076813972158567259200215660948447373041n,
  h: 8n,
  Gx: 7582035475627193640797276505418002166691739036475590846121162698650004832581n,
  Gy: 7801528930831391612913542953849263092120765287178679640990215688947513841260n,
  hash: () => { throw new Error("Not needed"); },
  randomBytes: (n = 32) => crypto.getRandomValues(new Uint8Array(n)),
  adjustScalarBytes: (b) => b,
});

export const ORDER = BabyJub.CURVE.n;
const G = BabyJub.ExtendedPoint.BASE;

// ── Types ───────────────────────────────────────────────────────────────────
export interface Point { x: bigint; y: bigint; }

export interface Ciphertext {
  C1: Point;
  C2: Point;
}

// ── Secure random scalar ────────────────────────────────────────────────────
export function secureRandom(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const n = BigInt("0x" + buf2hex(bytes));
  return (n % (ORDER - 1n)) + 1n;
}

// ── ElGamal encrypt ─────────────────────────────────────────────────────────
export function encrypt(
  m: bigint,
  pk: Point,
  r?: bigint
): { ct: Ciphertext; r: bigint } {
  if (m < 0n || m >= (1n << 32n)) {
    throw new Error(`Plaintext out of range: ${m}`);
  }
  if (m === 0n) {
    // m=0: C2 = r*pk (identity element doesn't need multiply)
    const rand = r ?? secureRandom();
    const pkPoint = BabyJub.ExtendedPoint.fromAffine(pk);
    const C1 = G.multiply(rand).toAffine();
    const C2 = pkPoint.multiply(rand).toAffine();
    return {
      ct: { C1: { x: C1.x, y: C1.y }, C2: { x: C2.x, y: C2.y } },
      r: rand,
    };
  }
  const rand = r ?? secureRandom();
  const pkPoint = BabyJub.ExtendedPoint.fromAffine(pk);

  const C1 = G.multiply(rand).toAffine();
  const rPk = pkPoint.multiply(rand);
  const C2 = m === 0n
    ? rPk.toAffine()
    : G.multiply(m).add(rPk).toAffine();

  return {
    ct: { C1: { x: C1.x, y: C1.y }, C2: { x: C2.x, y: C2.y } },
    r: rand,
  };
}

// ── Serialize / deserialize (128 bytes, little-endian) ──────────────────────
export function serializeCiphertext(ct: Ciphertext): Uint8Array {
  const buf = new Uint8Array(128);
  writeBigInt32LE(buf, ct.C1.x, 0);
  writeBigInt32LE(buf, ct.C1.y, 32);
  writeBigInt32LE(buf, ct.C2.x, 64);
  writeBigInt32LE(buf, ct.C2.y, 96);
  return buf;
}

export function deserializeCiphertext(buf: Uint8Array): Ciphertext {
  if (buf.length !== 128) throw new Error("Invalid ciphertext length");
  return {
    C1: { x: readBigInt32LE(buf, 0), y: readBigInt32LE(buf, 32) },
    C2: { x: readBigInt32LE(buf, 64), y: readBigInt32LE(buf, 96) },
  };
}

// ── Key derivation from Solana wallet ───────────────────────────────────────
export async function deriveKeyPair(
  signFunction: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<{ sk: bigint; pk: Point }> {
  const msg = new TextEncoder().encode("nexum_baby_jub_key_v1");
  const sig = await signFunction(msg);
  const ikm = sig;
  const info = new TextEncoder().encode("nexum-user-key");
  const skBytes = await hkdf(ikm, info, 32);
  const sk = (BigInt("0x" + buf2hex(skBytes)) % (ORDER - 1n)) + 1n;
  const pkPoint = G.multiply(sk).toAffine();
  return { sk, pk: { x: pkPoint.x, y: pkPoint.y } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export function buf2hex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

export { writeBigInt32LE, readBigInt32LE };

function writeBigInt32LE(buf: Uint8Array, n: bigint, offset: number) {
  for (let i = 0; i < 32; i++) {
    buf[offset + i] = Number((n >> BigInt(i * 8)) & 0xFFn);
  }
}

function readBigInt32LE(buf: Uint8Array, offset: number): bigint {
  let n = 0n;
  for (let i = 0; i < 32; i++) {
    n |= BigInt(buf[offset + i]) << BigInt(i * 8);
  }
  return n;
}

async function hkdf(ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const salt = new Uint8Array(32);
  const key = await crypto.subtle.importKey("raw", ikm.buffer as ArrayBuffer, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, info: info.buffer as ArrayBuffer },
    key,
    len * 8
  );
  return new Uint8Array(bits);
}
