/**
 * Contract interaction utilities for Nexum Protocol.
 *
 * Builds raw Solana transactions using @solana/web3.js —
 * no Anchor SDK dependency required. All instruction layouts
 * are derived from the IDL discriminators and account metadata.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  NEXUM_POOL_PROGRAM_ID,
  ZK_VERIFIER_PROGRAM_ID,
  NEXUM_POOL_DISCRIMINATORS,
  LEDGER_SEED,
  CONFIG_SEED,
  TREASURY_SEED,
  SETTLEMENT_SEED,
  DEFAULT_MINT,
  SETTLE_ATOMIC_CU_ESTIMATE,
  CU_BUFFER_BPS,
} from "./constants";
import type { SettleAtomicParams } from "../types/anchor";

// ─── PDA derivation helpers ───

/**
 * Derive the UserLedger PDA for a given owner and mint.
 * Seeds: ["ledger", owner, mint]
 */
export function findUserLedgerPda(
  owner: PublicKey,
  mint: PublicKey = DEFAULT_MINT
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [LEDGER_SEED, owner.toBuffer(), mint.toBuffer()],
    NEXUM_POOL_PROGRAM_ID
  );
}

/**
 * Derive the ProtocolConfig PDA.
 * Seeds: ["nexum_config"]
 */
export function findProtocolConfigPda(): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [CONFIG_SEED],
    NEXUM_POOL_PROGRAM_ID
  );
}

/**
 * Derive the TreasuryVault PDA for a given mint.
 * Seeds: ["treasury", mint]
 */
export function findTreasuryVaultPda(
  mint: PublicKey = DEFAULT_MINT
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [TREASURY_SEED, mint.toBuffer()],
    NEXUM_POOL_PROGRAM_ID
  );
}

/**
 * Derive the SettlementRecord PDA.
 * Seeds: ["settlement", ledger_a, nonce (u64 LE)]
 */
export function findSettlementRecordPda(
  ledgerA: PublicKey,
  nonce: number
): Promise<[PublicKey, number]> {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddress(
    [SETTLEMENT_SEED, ledgerA.toBuffer(), nonceBuf],
    NEXUM_POOL_PROGRAM_ID
  );
}

// ─── Instruction builders ───

/**
 * Serialize a number as u64 LE (8 bytes).
 */
function u64ToBytes(val: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(val));
  return buf;
}

/**
 * Build the settle_atomic instruction data.
 * Layout: [8-byte discriminator][nonce u64][proof_a 256][ct_a_lo 128][ct_a_hi 128]
 *         [audit_ct_a_lo 128][audit_ct_a_hi 128][proof_b 256][ct_b_lo 128][ct_b_hi 128]
 *         [audit_ct_b_lo 128][audit_ct_b_hi 128]
 */
function buildSettleAtomicData(params: SettleAtomicParams): Buffer {
  const dataSize = 8 + // discriminator
    8 + // nonce
    256 + // proof_a
    128 + 128 + 128 + 128 + // ct_a: lo, hi, audit_lo, audit_hi
    256 + // proof_b
    128 + 128 + 128 + 128; // ct_b: lo, hi, audit_lo, audit_hi
  // Total: 8 + 8 + 256 + 512 + 256 + 512 = 1552

  const data = Buffer.alloc(dataSize);
  let offset = 0;

  // Discriminator
  NEXUM_POOL_DISCRIMINATORS.settle_atomic.copy(data, offset);
  offset += 8;

  // nonce (u64 LE)
  u64ToBytes(params.nonce).copy(data, offset);
  offset += 8;

  // proof_a
  Buffer.from(params.proof_a).copy(data, offset);
  offset += 256;

  // ct_a_lo, ct_a_hi, audit_ct_a_lo, audit_ct_a_hi
  Buffer.from(params.new_ct_a_lo).copy(data, offset);
  offset += 128;
  Buffer.from(params.new_ct_a_hi).copy(data, offset);
  offset += 128;
  Buffer.from(params.audit_ct_a_lo).copy(data, offset);
  offset += 128;
  Buffer.from(params.audit_ct_a_hi).copy(data, offset);
  offset += 128;

  // proof_b
  Buffer.from(params.proof_b).copy(data, offset);
  offset += 256;

  // ct_b_lo, ct_b_hi, audit_ct_b_lo, audit_ct_b_hi
  Buffer.from(params.new_ct_b_lo).copy(data, offset);
  offset += 128;
  Buffer.from(params.new_ct_b_hi).copy(data, offset);
  offset += 128;
  Buffer.from(params.audit_ct_b_lo).copy(data, offset);
  offset += 128;
  Buffer.from(params.audit_ct_b_hi).copy(data, offset);
  offset += 128;

  return data;
}

/**
 * Build a settle_atomic TransactionInstruction.
 *
 * Accounts (from IDL, in order):
 *   0. ledger_a       (writable, PDA)
 *   1. ledger_b       (writable, PDA)
 *   2. settlement_record (writable, PDA)
 *   3. protocol_config (PDA)
 *   4. zk_verifier    (account)
 *   5. fee_payer      (writable, signer)
 *   6. system_program
 */
export async function createSettleAtomicInstruction(
  payer: PublicKey,
  counterparty: PublicKey,
  params: SettleAtomicParams,
  mint: PublicKey = DEFAULT_MINT
): Promise<TransactionInstruction> {
  const [ledgerA] = await findUserLedgerPda(payer, mint);
  const [ledgerB] = await findUserLedgerPda(counterparty, mint);
  const [settlementRecord] = await findSettlementRecordPda(ledgerA, params.nonce);
  const [protocolConfig] = await findProtocolConfigPda();

  const data = buildSettleAtomicData(params);

  const keys = [
    { pubkey: ledgerA, isSigner: false, isWritable: true },
    { pubkey: ledgerB, isSigner: false, isWritable: true },
    { pubkey: settlementRecord, isSigner: false, isWritable: true },
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: ZK_VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: NEXUM_POOL_PROGRAM_ID,
    keys,
    data,
  });
}

// ─── Transaction send helpers ───

export interface SettleAtomicResult {
  signature: string;
  computeUnits: number;
  slot: number;
}

/**
 * Estimate compute units for settle_atomic with a safety buffer.
 */
export function estimateSettleCu(): number {
  return Math.ceil(SETTLE_ATOMIC_CU_ESTIMATE * CU_BUFFER_BPS / 1000);
}

/**
 * Build and send a settle_atomic transaction.
 *
 * This constructs a Transaction with:
 * 1. Compute budget instruction (CU limit + price)
 * 2. settle_atomic instruction
 *
 * The signTransaction function is provided by the wallet adapter.
 */
export async function settleAtomic(
  connection: Connection,
  payer: PublicKey,
  counterparty: PublicKey,
  params: SettleAtomicParams,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  mint?: PublicKey
): Promise<SettleAtomicResult> {
  const cuLimit = estimateSettleCu();

  // Build instructions
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: cuLimit,
  });
  const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1,
  });

  const settleIx = await createSettleAtomicInstruction(
    payer,
    counterparty,
    params,
    mint
  );

  // Get latest blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  // Build transaction
  const transaction = new Transaction();
  transaction.add(computeBudgetIx, computePriceIx, settleIx);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer;

  // Sign with wallet
  const signedTx = await signTransaction(transaction);

  // Send transaction
  const signature = await connection.sendRawTransaction(
    signedTx.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    }
  );

  // Confirm transaction
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
    );
  }

  // Get actual compute units consumed from transaction metadata
  let computeUnitsConsumed = cuLimit; // fallback to estimate
  try {
    const txDetails = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (txDetails?.meta?.computeUnitsConsumed !== undefined) {
      computeUnitsConsumed = Number(txDetails.meta.computeUnitsConsumed);
    }
  } catch {
    // Non-critical: use estimate if we can't fetch details
  }

  return {
    signature,
    computeUnits: computeUnitsConsumed,
    slot: confirmation.context.slot,
  };
}
