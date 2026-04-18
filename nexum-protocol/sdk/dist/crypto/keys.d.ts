import type { Point } from "./elgamal";
/**
 * Derive Baby Jubjub public key from secret key
 */
export declare function derivePublicKey(sk: bigint): Point;
/**
 * Derive Baby Jubjub keypair from a hex-encoded seed
 */
export declare function deriveKeyPairFromSeed(seedHex: string): {
    sk: bigint;
    pk: Point;
};
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
export declare function deriveKeyPairFromWalletSignature(signature: Uint8Array): Promise<{
    sk: bigint;
    pk: Point;
}>;
