/**
 * Write BigInt as 32-byte little-endian into buffer
 */
export function writeBigInt32LE(buf: Uint8Array, n: bigint, offset: number): void {
  for (let i = 0; i < 32; i++) {
    buf[offset + i] = Number((n >> BigInt(i * 8)) & 0xFFn);
  }
}

/**
 * Read BigInt from 32-byte little-endian buffer
 */
export function readBigInt32LE(buf: Uint8Array, offset: number): bigint {
  let n = 0n;
  for (let i = 0; i < 32; i++) {
    n |= BigInt(buf[offset + i]) << BigInt(i * 8);
  }
  return n;
}

/**
 * Convert Uint8Array to hex string
 */
export function buf2hex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Split a 64-bit amount into hi/lo 32-bit parts
 */
export function splitU64(amount: bigint): { lo: bigint; hi: bigint } {
  return {
    lo: amount & 0xFFFFFFFFn,
    hi: amount >> 32n,
  };
}

/**
 * Combine hi/lo 32-bit parts into 64-bit amount
 */
export function combineHiLo(hi: bigint, lo: bigint): bigint {
  return hi * (1n << 32n) + lo;
}
