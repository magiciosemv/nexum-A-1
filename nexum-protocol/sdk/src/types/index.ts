export type { Point, Ciphertext } from "../crypto/elgamal";
export type { BSGSTable } from "../crypto/bsgs";

export type WorkerStatus = "loading" | "warming" | "ready" | "busy" | "error";

export interface WorkerState {
  cryptoStatus: WorkerStatus;
  proverStatus: WorkerStatus;
  warmupPct: number;
  provingPct: number;
  logs: string[];
}

export type CryptoWorkerMessage =
  | { type: "WARMUP" }
  | { type: "DECRYPT_BALANCE"; ct_lo: number[]; ct_hi: number[]; sk: string; id: string }
  | { type: "COMPUTE_NEW_CIPHERTEXT"; old_balance: bigint; transfer: bigint;
      user_pk_x: bigint; user_pk_y: bigint; audit_pk_x: bigint; audit_pk_y: bigint;
      is_sender: boolean; id: string };

export type ProverWorkerMessage =
  | { type: "PRELOAD_WASM"; wasm_path: string; zkey_path: string }
  | { type: "PROVE"; id: string; input: Record<string, string>; wasm_path: string; zkey_path: string };
