import { BabyJub } from "./elgamal";
const G = BabyJub.ExtendedPoint.BASE;
const TABLE_SIZE = 65536; // √2^32
// Baby Jubjub field prime
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Curve parameters a and d
const CURVE_A = 168700n;
const CURVE_D = 168696n;
function modP(n) {
    return ((n % P) + P) % P;
}
/**
 * Build BSGS lookup table (run at startup, ~200-800ms in Worker)
 * Stores i*G for i = 1..TABLE_SIZE-1 (i=0 is identity, handled separately)
 */
export function buildBSGSTable(onProgress) {
    const table = new Map();
    const yTable = new Map();
    let current = G; // Start from 1*G
    for (let i = 1; i < TABLE_SIZE; i++) {
        const affine = current.toAffine();
        const key = affine.x & 0xffffffffffffffffn; // x low 64 bits
        table.set(key, i);
        yTable.set(key, affine.y);
        current = current.add(G);
        if (i % 2000 === 0 && onProgress) {
            onProgress(i / TABLE_SIZE);
        }
    }
    const giantStepPoint = G.multiply(BigInt(TABLE_SIZE)).toAffine();
    // Precompute giantStepNeg in affine: negate = (-x mod p, y)
    const giantStepNegAffine = {
        x: modP(0n - giantStepPoint.x),
        y: giantStepPoint.y,
    };
    return {
        table,
        giantStep: { x: giantStepPoint.x, y: giantStepPoint.y },
        giantStepNegAffine,
        yTable,
    };
}
/**
 * Affine addition on twisted Edwards curve using Law 1.
 *
 * Law 1: x3 = (x1*y2+y1*x2)/(1+d*x1*x2*y1*y2), y3 = (y1*y2-a*x1*x2)/(1-d*x1*x2*y1*y2)
 * Returns null if the result is the identity element (0, 1) or if the
 * addition law is exceptional (denominator = 0).
 */
function affineAddLaw1(p1, p2) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x1x2 = modP(x1 * x2);
    const y1y2 = modP(y1 * y2);
    const k = modP(CURVE_D * x1x2 * y1y2);
    const numX = modP(x1 * y2 + y1 * x2);
    if (numX === 0n)
        return null;
    const denomX = modP(1n + k);
    const denomY = modP(1n - k);
    if (denomX === 0n || denomY === 0n)
        return null;
    const invDenomX = modPInverse(denomX);
    const invDenomY = modPInverse(denomY);
    const numY = modP(y1y2 - modP(CURVE_A * x1x2));
    return {
        x: modP(numX * invDenomX),
        y: modP(numY * invDenomY),
    };
}
/**
 * Affine addition using Law 2 (fallback for exceptional points of Law 1).
 *
 * Law 2: x3 = (x1*y2+y1*x2)/(1-d*x1*x2*y1*y2), y3 = (y1*y2+a*x1*x2)/(1+d*x1*x2*y1*y2)
 * Returns null if the addition law is exceptional.
 */
function affineAddLaw2(p1, p2) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x1x2 = modP(x1 * x2);
    const y1y2 = modP(y1 * y2);
    const k = modP(CURVE_D * x1x2 * y1y2);
    const numX = modP(x1 * y2 + y1 * x2);
    if (numX === 0n)
        return null;
    // Law 2: swapped denominators and +a instead of -a
    const denomX = modP(1n - k);
    const denomY = modP(1n + k);
    if (denomX === 0n || denomY === 0n)
        return null;
    const invDenomX = modPInverse(denomX);
    const invDenomY = modPInverse(denomY);
    const numY = modP(y1y2 + modP(CURVE_A * x1x2));
    return {
        x: modP(numX * invDenomX),
        y: modP(numY * invDenomY),
    };
}
/**
 * Affine addition with fallback: try Law 1 first, then Law 2.
 * At least one law always works for any valid point pair on twisted Edwards curves.
 */
function affineAdd(p1, p2) {
    // Try Law 1 first (standard group law)
    const result1 = affineAddLaw1(p1, p2);
    if (result1 !== null)
        return result1;
    // Fall back to Law 2 for exceptional points of Law 1
    return affineAddLaw2(p1, p2);
}
/** Modular inverse using extended Euclidean algorithm */
function modPInverse(a) {
    const aMod = modP(a);
    if (aMod === 0n)
        return 0n;
    let old_r = aMod, r = P;
    let old_s = 1n, s = 0n;
    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }
    // old_r should be 1 (GCD), old_s is the inverse
    return modP(old_s);
}
/**
 * BSGS decrypt: recover plaintext integer from ciphertext + secret key
 * Range: m ∈ [0, 2^32)
 *
 * Uses two-phase BSGS:
 *   baby-step: table stores i*G for i = 0..65535 (65536 entries)
 *   giant-step: search target - j*(65536*G) in baby-step table, j = 0..65535
 *   Combined range: 65536 * 65536 = 2^32 = 4,294,967,296 values
 *
 * Uses affine arithmetic with dual addition laws, falling back to
 * scalar multiply for truly exceptional point pairs.
 */
export function bsgsDecrypt(ct, sk, bsgsTable) {
    const C1 = BabyJub.ExtendedPoint.fromAffine(ct.C1);
    const C2 = BabyJub.ExtendedPoint.fromAffine(ct.C2);
    const skC1 = C1.multiply(sk);
    const mG = C2.subtract(skC1); // m·G
    // Check if mG is the identity (m=0)
    if (mG.equals(BabyJub.ExtendedPoint.ZERO)) {
        return 0n;
    }
    // Normalize mG to affine coordinates
    const mGaffine = mG.toAffine();
    const giantStepNeg = bsgsTable.giantStepNegAffine;
    const giantStepPoint = BabyJub.ExtendedPoint.fromAffine(bsgsTable.giantStep);
    // Use affine arithmetic for giant steps, with fallback to scalar multiply
    let cx = mGaffine.x;
    let cy = mGaffine.y;
    for (let j = 0; j < TABLE_SIZE; j++) {
        // Table lookup by x low 64 bits, verify y
        const key = cx & 0xffffffffffffffffn;
        const i = bsgsTable.table.get(key);
        if (i !== undefined) {
            const expectedY = bsgsTable.yTable.get(key);
            if (expectedY === cy) {
                return BigInt(j) * BigInt(TABLE_SIZE) + BigInt(i);
            }
        }
        // Advance by one giant step using affine addition (cursor - giantStep)
        const sum = affineAdd({ x: cx, y: cy }, giantStepNeg);
        if (sum !== null) {
            cx = sum.x;
            cy = sum.y;
        }
        else {
            // Both addition laws failed (exceptional point pair).
            // Fall back to scalar multiply: compute mG - (j+1)*TABLE_SIZE*G from scratch.
            const nextJ = BigInt(j + 1);
            const jStep = giantStepPoint.multiply(nextJ);
            const freshCursor = mG.subtract(jStep);
            if (freshCursor.equals(BabyJub.ExtendedPoint.ZERO)) {
                return nextJ * BigInt(TABLE_SIZE);
            }
            const freshAffine = freshCursor.toAffine();
            cx = freshAffine.x;
            cy = freshAffine.y;
        }
    }
    throw new Error("BSGS failed: value not in range [0, 2^32)");
}
/**
 * Decrypt full balance (hi + lo, each via BSGS)
 */
export function decryptBalance(ct_lo_bytes, ct_hi_bytes, sk, table, deserialize) {
    const lo = bsgsDecrypt(deserialize(ct_lo_bytes), sk, table);
    const hi = bsgsDecrypt(deserialize(ct_hi_bytes), sk, table);
    return hi * (1n << 32n) + lo;
}
