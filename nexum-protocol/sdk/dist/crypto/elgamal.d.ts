export declare const BabyJub: import("@noble/curves/abstract/edwards").CurveFn;
export declare const ORDER: bigint;
export interface Point {
    x: bigint;
    y: bigint;
}
export interface Ciphertext {
    C1: Point;
    C2: Point;
}
export declare function secureRandom(): bigint;
export declare function encrypt(m: bigint, pk: Point, r?: bigint): {
    ct: Ciphertext;
    r: bigint;
};
export declare function serializeCiphertext(ct: Ciphertext): Uint8Array;
export declare function deserializeCiphertext(buf: Uint8Array): Ciphertext;
export declare function deriveKeyPair(signFunction: (msg: Uint8Array) => Promise<Uint8Array>): Promise<{
    sk: bigint;
    pk: Point;
}>;
export declare function buf2hex(buf: Uint8Array): string;
export { writeBigInt32LE, readBigInt32LE };
declare function writeBigInt32LE(buf: Uint8Array, n: bigint, offset: number): void;
declare function readBigInt32LE(buf: Uint8Array, offset: number): bigint;
