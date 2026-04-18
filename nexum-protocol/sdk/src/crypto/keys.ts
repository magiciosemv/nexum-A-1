import { BabyJub, ORDER } from "./elgamal";
import { buf2hex } from "./utils";
import type { Point } from "./elgamal";

const G = BabyJub.ExtendedPoint.BASE;

/**
 * Derive Baby Jubjub public key from secret key
 */
export function derivePublicKey(sk: bigint): Point {
  const pk = G.multiply(sk).toAffine();
  return { x: pk.x, y: pk.y };
}

/**
 * Derive Baby Jubjub keypair from a hex-encoded seed
 */
export function deriveKeyPairFromSeed(seedHex: string): { sk: bigint; pk: Point } {
  const sk = (BigInt("0x" + seedHex.slice(0, 64)) % (ORDER - 1n)) + 1n;
  return { sk, pk: derivePublicKey(sk) };
}

/**
 * Derive Baby Jubjub keypair from a Solana wallet signature.
 *
 * Takes the raw signature bytes (64 bytes from Ed25519), hashes them with
 * SHA-256 to produce a deterministic 32-byte seed, then feeds that seed
 * into deriveKeyPairFromSeed.
 *
 * This allows the same Solana wallet to deterministically produce the same
 * Baby Jubjub keypair across sessions without storing extra state.
 */
export async function deriveKeyPairFromWalletSignature(
  signature: Uint8Array,
): Promise<{ sk: bigint; pk: Point }> {
  const hashBuf = await crypto.subtle.digest("SHA-256", signature.buffer as ArrayBuffer);
  const seedHex = buf2hex(new Uint8Array(hashBuf));
  return deriveKeyPairFromSeed(seedHex);
}
