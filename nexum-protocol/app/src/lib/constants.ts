import { PublicKey } from "@solana/web3.js";

// ─── Program IDs (from IDL files) ───

export const NEXUM_POOL_PROGRAM_ID = new PublicKey(
  "BpsDqXMPwPz8rpktTec4cnpCtxxj7J1nsU8F45KLVrEN"
);

export const ZK_VERIFIER_PROGRAM_ID = new PublicKey(
  "EArRMxL5MSNTXRt4D9wv5MfrXYifhUSzAXbUiaqKMt3U"
);

export const AUDIT_GATE_PROGRAM_ID = new PublicKey(
  "6eDHCsfJxJyXvtoccuzrbHuHb8PZ21cVeppphC3Xem6H"
);

// ─── Network configuration ───

export const SOLANA_RPC_ENDPOINT = "https://api.devnet.solana.com";
export const SOLANA_WS_ENDPOINT = "wss://api.devnet.solana.com";

// ─── Instruction discriminators (8-byte, from IDL) ───

export const NEXUM_POOL_DISCRIMINATORS = {
  create_user_ledger: Buffer.from([91, 133, 100, 35, 153, 179, 100, 42]),
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  initialize_pool: Buffer.from([95, 180, 10, 172, 84, 174, 232, 40]),
  settle_atomic: Buffer.from([125, 171, 110, 28, 59, 108, 127, 23]),
  withdraw: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]),
} as const;

export const ZK_VERIFIER_DISCRIMINATORS = {
  verify_balance_transition: Buffer.from([118, 20, 109, 87, 73, 234, 70, 186]),
} as const;

// ─── PDA seed constants ───

/** "ledger" as UTF-8 bytes for UserLedger PDA seeds */
export const LEDGER_SEED = Buffer.from("ledger", "utf-8");

/** "nexum_config" as UTF-8 bytes for ProtocolConfig PDA seeds */
export const CONFIG_SEED = Buffer.from("nexum_config", "utf-8");

/** "treasury" as UTF-8 bytes for TreasuryVault PDA seeds */
export const TREASURY_SEED = Buffer.from("treasury", "utf-8");

/** "settlement" as UTF-8 bytes for SettlementRecord PDA seeds */
export const SETTLEMENT_SEED = Buffer.from("settlement", "utf-8");

// ─── Default mint (USDC devnet) ───

export const DEFAULT_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // devnet USDC
);

// ─── Compute Unit estimates ───

/** Estimated CU for settle_atomic (2x Groth16 verification + state updates) */
export const SETTLE_ATOMIC_CU_ESTIMATE = 400_000;

/** CU buffer margin added to estimates */
export const CU_BUFFER_BPS = 1200; // 20% buffer
