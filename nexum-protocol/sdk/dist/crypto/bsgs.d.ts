import type { Ciphertext, Point } from "./elgamal";
export interface BSGSTable {
    table: Map<bigint, number>;
    giantStep: Point;
    /** Precomputed negated giant step in affine coordinates for fast stepping */
    giantStepNegAffine: Point;
    /** Precomputed y-coordinates for baby-step table entries */
    yTable: Map<bigint, bigint>;
}
/**
 * Build BSGS lookup table (run at startup, ~200-800ms in Worker)
 * Stores i*G for i = 1..TABLE_SIZE-1 (i=0 is identity, handled separately)
 */
export declare function buildBSGSTable(onProgress?: (pct: number) => void): BSGSTable;
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
export declare function bsgsDecrypt(ct: Ciphertext, sk: bigint, bsgsTable: BSGSTable): bigint;
/**
 * Decrypt full balance (hi + lo, each via BSGS)
 */
export declare function decryptBalance(ct_lo_bytes: Uint8Array, ct_hi_bytes: Uint8Array, sk: bigint, table: BSGSTable, deserialize: (buf: Uint8Array) => Ciphertext): bigint;
