/**
 * Write BigInt as 32-byte little-endian into buffer
 */
export declare function writeBigInt32LE(buf: Uint8Array, n: bigint, offset: number): void;
/**
 * Read BigInt from 32-byte little-endian buffer
 */
export declare function readBigInt32LE(buf: Uint8Array, offset: number): bigint;
/**
 * Convert Uint8Array to hex string
 */
export declare function buf2hex(buf: Uint8Array): string;
/**
 * Split a 64-bit amount into hi/lo 32-bit parts
 */
export declare function splitU64(amount: bigint): {
    lo: bigint;
    hi: bigint;
};
/**
 * Combine hi/lo 32-bit parts into 64-bit amount
 */
export declare function combineHiLo(hi: bigint, lo: bigint): bigint;
