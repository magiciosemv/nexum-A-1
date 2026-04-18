/**
 * TypeScript type definitions extracted from Anchor IDL files.
 * These types mirror the on-chain program structs for type-safe
 * transaction building with @solana/web3.js (no Anchor SDK dependency).
 */

// Fixed-size byte array helpers
export type Bytes32 = Uint8Array; // 32 bytes
export type Bytes128 = Uint8Array; // 128 bytes (Baby Jubjub ElGamal ciphertext component)
export type Bytes256 = Uint8Array; // 256 bytes (Groth16 proof: A:64 + B:128 + C:64)

// ─── nexum_pool types ───

export interface DepositParams {
  proof: Bytes256;
  new_ct_lo: Bytes128;
  new_ct_hi: Bytes128;
  audit_ct_lo: Bytes128;
  audit_ct_hi: Bytes128;
  amount: number; // u64
}

export interface InitializePoolParams {
  audit_pk_x: Bytes32;
  audit_pk_y: Bytes32;
  fee_bps: number; // u64
}

export interface SettleAtomicParams {
  nonce: number; // u64
  proof_a: Bytes256;
  new_ct_a_lo: Bytes128;
  new_ct_a_hi: Bytes128;
  audit_ct_a_lo: Bytes128;
  audit_ct_a_hi: Bytes128;
  proof_b: Bytes256;
  new_ct_b_lo: Bytes128;
  new_ct_b_hi: Bytes128;
  audit_ct_b_lo: Bytes128;
  audit_ct_b_hi: Bytes128;
}

export interface WithdrawParams {
  proof: Bytes256;
  new_ct_lo: Bytes128;
  new_ct_hi: Bytes128;
  audit_ct_lo: Bytes128;
  audit_ct_hi: Bytes128;
  amount: number; // u64
}

export interface UserLedger {
  owner: string; // PublicKey base58
  mint: string;
  balance_ct_lo: Bytes128;
  balance_ct_hi: Bytes128;
  audit_ct_lo: Bytes128;
  audit_ct_hi: Bytes128;
  version: number; // u64
  status: LedgerStatus;
  last_settlement_id: Bytes32;
  bump: number; // u8
}

export interface ProtocolConfigAccount {
  admin: string;
  audit_pk_x: Bytes32;
  audit_pk_y: Bytes32;
  fee_bps: number;
  is_paused: boolean;
  bump: number;
}

export interface SettlementRecord {
  initiator: string;
  counterparty: string;
  asset_a_mint: string;
  asset_b_mint: string;
  init_audit_ct_lo: Bytes128;
  init_audit_ct_hi: Bytes128;
  cp_audit_ct_lo: Bytes128;
  cp_audit_ct_hi: Bytes128;
  init_zk_proof: Bytes256;
  cp_zk_proof: Bytes256;
  settled_at: number; // i64
  bump: number;
}

export enum LedgerStatus {
  Active = 0,
  PendingSettle = 1,
  Emergency = 2,
}

// ─── zk_verifier types ───

export interface VerifyBalanceTransitionArgs {
  proof_bytes: Bytes256;
  pub_inputs: Uint8Array; // 30 x 32 = 960 bytes
}

// ─── audit_gate types ───

export interface RequestAuditParams {
  nonce: number; // u64
  reason_hash: Bytes32;
  jurisdiction: number; // u8
}

// ─── Error codes ───

export interface ProgramError {
  code: number;
  name: string;
  msg: string;
}

// nexum_pool error codes
export const NEXUM_POOL_ERRORS: ProgramError[] = [
  { code: 6000, name: "LedgerNotActive", msg: "Ledger is not in Active status" },
  { code: 6001, name: "SameLedger", msg: "Cannot settle a ledger with itself" },
  { code: 6002, name: "MintMismatch", msg: "Asset mint mismatch between ledgers" },
  { code: 6003, name: "ZkVerificationFailed", msg: "ZK proof verification failed" },
  { code: 6004, name: "VersionMismatch", msg: "Version mismatch: proof is stale or replayed" },
  { code: 6005, name: "TransferAmountMismatch", msg: "Transfer amounts in audit ciphertexts are inconsistent" },
  { code: 6006, name: "ProtocolPaused", msg: "Protocol is paused" },
  { code: 6007, name: "InsufficientBalance", msg: "Insufficient balance" },
  { code: 6008, name: "InvalidAuditor", msg: "Invalid auditor: not registered or revoked" },
  { code: 6009, name: "AltBn128Error", msg: "alt_bn128 syscall error" },
];

// zk_verifier error codes
export const ZK_VERIFIER_ERRORS: ProgramError[] = [
  { code: 6000, name: "InvalidPublicInputsLength", msg: "Public inputs length must be 30 x 32 bytes" },
  { code: 6001, name: "AltBn128Error", msg: "alt_bn128 syscall failed" },
  { code: 6002, name: "ProofInvalid", msg: "ZK proof verification failed: pairing check rejected" },
];

// audit_gate error codes
export const AUDIT_GATE_ERRORS: ProgramError[] = [
  { code: 6000, name: "AuditorNotRegistered", msg: "Auditor not registered" },
  { code: 6001, name: "AuditorAlreadyRegistered", msg: "Auditor already registered" },
  { code: 6002, name: "Unauthorized", msg: "Only admin can register auditors" },
  { code: 6003, name: "AuditAlreadyExists", msg: "Audit log already exists for this settlement" },
];
