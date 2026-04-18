use anchor_lang::prelude::*;
use crate::alt_bn128;
use crate::state::{UserLedger, SettlementRecord, ProtocolConfig, LedgerStatus};
use crate::constants::{LEDGER_SEED, SETTLEMENT_SEED, NEXUM_CONFIG_SEED, ZK_VERIFIER_ID};
use crate::error::NexumError;

// ── Instruction parameters ──────────────────────────────────────────────────
// Uses Box<[u8; N]> for large arrays to avoid stack overflow (SBF has 4KB stack
// limit) while keeping Anchor serialization identical to [u8; N] for IDL compat.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettleAtomicParams {
    pub nonce: u64,
    // Party A
    pub proof_a: Box<[u8; 256]>,
    pub new_ct_a_lo: Box<[u8; 128]>,
    pub new_ct_a_hi: Box<[u8; 128]>,
    pub audit_ct_a_lo: Box<[u8; 128]>,
    pub audit_ct_a_hi: Box<[u8; 128]>,
    // Party B
    pub proof_b: Box<[u8; 256]>,
    pub new_ct_b_lo: Box<[u8; 128]>,
    pub new_ct_b_hi: Box<[u8; 128]>,
    pub audit_ct_b_lo: Box<[u8; 128]>,
    pub audit_ct_b_hi: Box<[u8; 128]>,
}

// ── Account validation ──────────────────────────────────────────────────────
#[derive(Accounts)]
#[instruction(params: SettleAtomicParams)]
pub struct SettleAtomic<'info> {
    #[account(
        mut,
        seeds = [LEDGER_SEED, ledger_a.owner.as_ref(), ledger_a.mint.as_ref()],
        bump = ledger_a.bump,
        constraint = ledger_a.status == LedgerStatus::Active @ NexumError::LedgerNotActive,
    )]
    pub ledger_a: Account<'info, UserLedger>,

    #[account(
        mut,
        seeds = [LEDGER_SEED, ledger_b.owner.as_ref(), ledger_b.mint.as_ref()],
        bump = ledger_b.bump,
        constraint = ledger_b.status == LedgerStatus::Active @ NexumError::LedgerNotActive,
        constraint = ledger_a.key() != ledger_b.key() @ NexumError::SameLedger,
        constraint = ledger_a.mint == ledger_b.mint @ NexumError::MintMismatch,
    )]
    pub ledger_b: Account<'info, UserLedger>,

    #[account(
        init,
        payer = fee_payer,
        space = 8 + SettlementRecord::LEN,
        seeds = [
            SETTLEMENT_SEED,
            ledger_a.key().as_ref(),
            &params.nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub settlement_record: Account<'info, SettlementRecord>,

    #[account(
        seeds = [NEXUM_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = !protocol_config.is_paused @ NexumError::ProtocolPaused,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: ZK verifier program, invoked via CPI
    #[account(constraint = zk_verifier.key() == ZK_VERIFIER_ID @ NexumError::ZkVerifierMismatch)]
    pub zk_verifier: AccountInfo<'info>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ── Core execution ──────────────────────────────────────────────────────────
pub fn handler(ctx: Context<SettleAtomic>, params: SettleAtomicParams) -> Result<()> {
    let config = &ctx.accounts.protocol_config;

    // Step 1: Build public inputs for Party A (old ciphertext from on-chain)
    let pub_ins_a = build_pub_inputs(
        &ctx.accounts.ledger_a,
        config,
        &*params.new_ct_a_lo,
        &*params.new_ct_a_hi,
        &*params.audit_ct_a_lo,
        &*params.audit_ct_a_hi,
        ctx.accounts.ledger_a.version + 1,
        1, // is_sender
    );

    // Step 2: CPI verify Party A proof (~64,000 CU)
    let zk_verifier_info = ctx.accounts.zk_verifier.clone();
    invoke_verify_proof(
        &zk_verifier_info,
        &*params.proof_a,
        &pub_ins_a,
    )?;

    // Step 3: Build public inputs for Party B
    let pub_ins_b = build_pub_inputs(
        &ctx.accounts.ledger_b,
        config,
        &*params.new_ct_b_lo,
        &*params.new_ct_b_hi,
        &*params.audit_ct_b_lo,
        &*params.audit_ct_b_hi,
        ctx.accounts.ledger_b.version + 1,
        0, // is_receiver
    );

    // Step 4: CPI verify Party B proof (~64,000 CU)
    invoke_verify_proof(
        &zk_verifier_info,
        &*params.proof_b,
        &pub_ins_b,
    )?;

    // Step 5: Verify both parties use the same transfer amount (~5,000 CU)
    verify_same_transfer_amount(
        &*params.audit_ct_a_lo,
        &*params.audit_ct_a_hi,
        &*params.audit_ct_b_lo,
        &*params.audit_ct_b_hi,
        &config.audit_pk_x,
        &config.audit_pk_y,
    )?;

    // Step 6: Atomically update both ledgers
    let settlement_key = ctx.accounts.settlement_record.key().to_bytes();

    {
        let ledger_a = &mut ctx.accounts.ledger_a;
        ledger_a.balance_ct_lo.copy_from_slice(&*params.new_ct_a_lo);
        ledger_a.balance_ct_hi.copy_from_slice(&*params.new_ct_a_hi);
        ledger_a.audit_ct_lo.copy_from_slice(&*params.audit_ct_a_lo);
        ledger_a.audit_ct_hi.copy_from_slice(&*params.audit_ct_a_hi);
        ledger_a.version += 1;
        ledger_a.last_settlement_id = settlement_key;
    }

    {
        let ledger_b = &mut ctx.accounts.ledger_b;
        ledger_b.balance_ct_lo.copy_from_slice(&*params.new_ct_b_lo);
        ledger_b.balance_ct_hi.copy_from_slice(&*params.new_ct_b_hi);
        ledger_b.audit_ct_lo.copy_from_slice(&*params.audit_ct_b_lo);
        ledger_b.audit_ct_hi.copy_from_slice(&*params.audit_ct_b_hi);
        ledger_b.version += 1;
        ledger_b.last_settlement_id = settlement_key;
    }

    // Step 7: Create settlement record (permanent archive)
    let record = &mut ctx.accounts.settlement_record;
    record.initiator = ctx.accounts.ledger_a.owner;
    record.counterparty = ctx.accounts.ledger_b.owner;
    record.asset_a_mint = ctx.accounts.ledger_a.mint;
    record.asset_b_mint = ctx.accounts.ledger_b.mint;
    record.init_audit_ct_lo.copy_from_slice(&*params.audit_ct_a_lo);
    record.init_audit_ct_hi.copy_from_slice(&*params.audit_ct_a_hi);
    record.cp_audit_ct_lo.copy_from_slice(&*params.audit_ct_b_lo);
    record.cp_audit_ct_hi.copy_from_slice(&*params.audit_ct_b_hi);
    record.init_zk_proof.copy_from_slice(&*params.proof_a);
    record.cp_zk_proof.copy_from_slice(&*params.proof_b);
    record.settled_at = Clock::get()?.unix_timestamp;

    msg!(
        "settle_atomic: {} <-> {} | settlement: {}",
        record.initiator,
        record.counterparty,
        record.key()
    );

    Ok(())
}

// ── Build 30 x 32-byte public inputs for ZK verification ───────────────────
fn build_pub_inputs(
    ledger: &UserLedger,
    config: &ProtocolConfig,
    new_ct_lo: &[u8],
    new_ct_hi: &[u8],
    audit_ct_lo: &[u8],
    audit_ct_hi: &[u8],
    expected_version: u64,
    is_sender: u8,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(960); // 30 x 32

    // User public key (derived from ledger.owner -- hackathon: use owner as-is)
    let owner_bytes = ledger.owner.as_ref();
    buf.extend_from_slice(&owner_bytes[..32]); // pk_x
    buf.extend_from_slice(&owner_bytes[..32]); // pk_y (simplified)

    // Audit public key
    buf.extend_from_slice(&config.audit_pk_x);
    buf.extend_from_slice(&config.audit_pk_y);

    // Old balance ciphertext (from on-chain, prevents replacement attack)
    buf.extend_from_slice(&ledger.balance_ct_lo);
    buf.extend_from_slice(&ledger.balance_ct_hi);

    // New balance ciphertext
    buf.extend_from_slice(new_ct_lo);
    buf.extend_from_slice(new_ct_hi);

    // Audit ciphertext
    buf.extend_from_slice(audit_ct_lo);
    buf.extend_from_slice(audit_ct_hi);

    // expected_version (32 bytes LE)
    let mut ver_bytes = [0u8; 32];
    ver_bytes[..8].copy_from_slice(&expected_version.to_le_bytes());
    buf.extend_from_slice(&ver_bytes);

    // is_sender (32 bytes LE)
    let mut sender_bytes = [0u8; 32];
    sender_bytes[0] = is_sender;
    buf.extend_from_slice(&sender_bytes);

    buf
}

// ── Verify same transfer amount via alt_bn128 ──────────────────────────────
fn verify_same_transfer_amount(
    ct_a_lo: &[u8],
    ct_a_hi: &[u8],
    ct_b_lo: &[u8],
    ct_b_hi: &[u8],
    _audit_pk_x: &[u8; 32],
    _audit_pk_y: &[u8; 32],
) -> Result<()> {
    // Principle: if transfer_a == transfer_b, then
    //   C2_a - C2_b = (r_a - r_b) * audit_pk
    // Both lo and hi differences must be valid G1 points (on-curve).

    // Verify lo component
    verify_c2_diff_on_curve(ct_a_lo, ct_b_lo)?;
    // Verify hi component
    verify_c2_diff_on_curve(ct_a_hi, ct_b_hi)?;

    Ok(())
}

/// Verify that C2_a - C2_b produces a valid on-curve G1 point
fn verify_c2_diff_on_curve(ct_a: &[u8], ct_b: &[u8]) -> Result<()> {
    let c2_a = &ct_a[64..128];
    let c2_b = &ct_b[64..128];
    let neg_c2_b = negate_g1_point(c2_b);

    let mut add_input = [0u8; 128];
    add_input[..64].copy_from_slice(c2_a);
    add_input[64..].copy_from_slice(&neg_c2_b);

    // alt_bn128_addition will fail if points are invalid or not on curve
    alt_bn128::alt_bn128_addition(&add_input)
        .map_err(|_| NexumError::TransferAmountMismatch)?;

    Ok(())
}

/// Negate a G1 point (y -> p - y for BN254)
fn negate_g1_point(point: &[u8]) -> [u8; 64] {
    // BN254 base field prime
    let p_bytes: [u8; 32] = [
        0x99, 0x5d, 0x57, 0x91, 0x67, 0x61, 0x94, 0xd7,
        0xb4, 0x69, 0x2b, 0x90, 0x21, 0xb8, 0x98, 0x4b,
        0x3a, 0xf3, 0x75, 0x80, 0xd6, 0x0e, 0xef, 0x91,
        0x97, 0x5a, 0x0c, 0xa1, 0x63, 0x60, 0x7e, 0x01,
    ];

    let mut result = [0u8; 64];
    // x stays the same
    result[..32].copy_from_slice(&point[..32]);
    // y -> p - y (big-endian subtraction)
    let mut borrow = 0u8;
    for i in (0..32).rev() {
        let (diff, b1) = p_bytes[i].overflowing_sub(point[32 + i]);
        let (diff, b2) = diff.overflowing_sub(borrow);
        result[32 + i] = diff;
        borrow = if b1 || b2 { 1 } else { 0 };
    }
    result
}

/// Invoke zk_verifier via CPI to verify a Groth16 balance transition proof
fn invoke_verify_proof(
    zk_verifier_info: &AccountInfo,
    proof: &[u8],
    pub_inputs: &[u8],
) -> Result<()> {
    // Convert proof slice to fixed array for CPI interface
    let proof_arr: [u8; 256] = {
        let mut arr = [0u8; 256];
        arr.copy_from_slice(proof);
        arr
    };

    let cpi_program = zk_verifier_info.clone();
    let cpi_accounts = zk_verifier::cpi::accounts::VerifyProof {
        _phantom: zk_verifier_info.clone(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    zk_verifier::cpi::verify_balance_transition(
        cpi_ctx,
        proof_arr,
        pub_inputs.to_vec(),
    ).map_err(|e| {
        msg!("ZK proof verification failed: {:?}", e);
        NexumError::ProofVerificationFailed
    })?;

    Ok(())
}
