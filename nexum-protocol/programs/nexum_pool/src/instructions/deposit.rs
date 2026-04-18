use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use crate::state::{UserLedger, ProtocolConfig, LedgerStatus};
use crate::constants::{LEDGER_SEED, NEXUM_CONFIG_SEED, TREASURY_SEED, ZK_VERIFIER_ID, SPL_TOKEN_ID};
use crate::error::NexumError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositParams {
    pub proof: [u8; 256],
    pub new_ct_lo: [u8; 128],
    pub new_ct_hi: [u8; 128],
    pub audit_ct_lo: [u8; 128],
    pub audit_ct_hi: [u8; 128],
    pub amount: u64,
}

#[derive(Accounts)]
#[instruction(params: DepositParams)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [LEDGER_SEED, depositor.key().as_ref(), mint.key().as_ref()],
        bump = user_ledger.bump,
        constraint = user_ledger.status == LedgerStatus::Active @ NexumError::LedgerNotActive,
        constraint = user_ledger.owner == depositor.key() @ NexumError::OwnerMismatch,
    )]
    pub user_ledger: Account<'info, UserLedger>,

    #[account(
        seeds = [NEXUM_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = !protocol_config.is_paused @ NexumError::ProtocolPaused,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: Treasury vault PDA
    #[account(
        seeds = [TREASURY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub treasury_vault: AccountInfo<'info>,

    /// CHECK: Mint account — validated against user_ledger.mint
    #[account(constraint = mint.key() == user_ledger.mint @ NexumError::MintMismatch)]
    pub mint: AccountInfo<'info>,

    /// CHECK: Depositor's associated token account — validated in handler
    #[account(mut)]
    pub depositor_ata: AccountInfo<'info>,

    /// CHECK: Treasury's associated token account — validated in handler
    #[account(mut)]
    pub treasury_ata: AccountInfo<'info>,

    /// CHECK: Fee recipient's associated token account (receives protocol fees)
    #[account(mut)]
    pub fee_recipient_ata: AccountInfo<'info>,

    /// CHECK: SPL Token program — validated against known program ID
    #[account(constraint = token_program.key() == SPL_TOKEN_ID @ NexumError::TokenProgramMismatch)]
    pub token_program: AccountInfo<'info>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: ZK verifier program — validated against known program ID
    #[account(constraint = zk_verifier.key() == ZK_VERIFIER_ID @ NexumError::ZkVerifierMismatch)]
    pub zk_verifier: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, params: DepositParams) -> Result<()> {
    // Step 0: Validate token account ownership — depositor_ata, treasury_ata,
    // and fee_recipient_ata must be owned by the SPL Token program
    require!(
        *ctx.accounts.depositor_ata.owner == ctx.accounts.token_program.key(),
        NexumError::TokenProgramMismatch
    );
    require!(
        *ctx.accounts.treasury_ata.owner == ctx.accounts.token_program.key(),
        NexumError::TokenProgramMismatch
    );
    require!(
        *ctx.accounts.fee_recipient_ata.owner == ctx.accounts.token_program.key(),
        NexumError::TokenProgramMismatch
    );

    // Step 1: Verify deposit ZK proof via CPI
    invoke_verify_proof(
        &ctx.accounts.zk_verifier,
        &params.proof,
        &build_deposit_pub_inputs(&ctx.accounts.user_ledger, &ctx.accounts.protocol_config, &params),
    )?;

    // Step 2: SPL Token transfer from depositor ATA to Treasury ATA
    let amount = params.amount;
    if amount > 0 {
        let mut data = Vec::with_capacity(9);
        data.push(12u8); // Transfer discriminator for SPL Token
        data.extend_from_slice(&amount.to_le_bytes());

        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.depositor_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.treasury_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.depositor.key(), true
                ),
            ],
            data,
        };

        invoke(
            &transfer_ix,
            &[
                ctx.accounts.depositor_ata.clone(),
                ctx.accounts.treasury_ata.clone(),
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.token_program.clone(),
            ],
        ).map_err(|e| {
            msg!("SPL Token deposit transfer failed: {:?}", e);
            NexumError::AltBn128Error
        })?;
    }

    // Step 2b: Deduct protocol fee from the deposited amount
    // Fee = amount * fee_bps / 10000, transferred from treasury_ata to fee_recipient_ata
    let fee_bps = ctx.accounts.protocol_config.fee_bps;
    let fee_amount = if fee_bps > 0 && amount > 0 {
        amount
            .checked_mul(fee_bps)
            .and_then(|v| v.checked_div(10000))
            .unwrap_or(0)
    } else {
        0
    };

    if fee_amount > 0 {
        // Transfer fee from treasury_ata to fee_recipient_ata
        // Treasury PDA signs via invoke_signed
        let (_, treasury_bump) = Pubkey::find_program_address(
            &[TREASURY_SEED, ctx.accounts.mint.key().as_ref()],
            &crate::ID,
        );
        let bump_bytes = [treasury_bump];
        let mint_key = ctx.accounts.mint.key();
        let treasury_seeds: &[&[u8]] = &[
            TREASURY_SEED,
            mint_key.as_ref(),
            &bump_bytes,
        ];

        let mut fee_data = Vec::with_capacity(9);
        fee_data.push(12u8); // Transfer discriminator
        fee_data.extend_from_slice(&fee_amount.to_le_bytes());

        let fee_transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.treasury_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.fee_recipient_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.treasury_vault.key(), true
                ),
            ],
            data: fee_data,
        };

        let signer_seeds = &[treasury_seeds];
        anchor_lang::solana_program::program::invoke_signed(
            &fee_transfer_ix,
            &[
                ctx.accounts.treasury_ata.clone(),
                ctx.accounts.fee_recipient_ata.clone(),
                ctx.accounts.treasury_vault.clone(),
                ctx.accounts.token_program.clone(),
            ],
            signer_seeds,
        ).map_err(|e| {
            msg!("SPL Token fee transfer failed: {:?}", e);
            NexumError::AltBn128Error
        })?;

        msg!(
            "deposit fee: {} bps | fee_amount: {} | net_deposit: {}",
            fee_bps,
            fee_amount,
            amount.saturating_sub(fee_amount)
        );
    }

    // Step 3: Update ledger with new encrypted balance
    let ledger = &mut ctx.accounts.user_ledger;
    ledger.balance_ct_lo = params.new_ct_lo;
    ledger.balance_ct_hi = params.new_ct_hi;
    ledger.audit_ct_lo = params.audit_ct_lo;
    ledger.audit_ct_hi = params.audit_ct_hi;
    ledger.version += 1;

    msg!(
        "deposit: {} | amount: {} | ledger version: {}",
        ctx.accounts.depositor.key(),
        amount,
        ledger.version
    );

    Ok(())
}

fn build_deposit_pub_inputs(ledger: &UserLedger, config: &ProtocolConfig, params: &DepositParams) -> Vec<u8> {
    let mut buf = Vec::with_capacity(960);
    // User public key (Baby Jubjub, derived from Solana owner)
    let owner_bytes = ledger.owner.as_ref();
    buf.extend_from_slice(&owner_bytes[..32]); // pk_x
    buf.extend_from_slice(&owner_bytes[..32]); // pk_y (simplified: use owner for both)
    // Audit public key (from protocol config)
    buf.extend_from_slice(&config.audit_pk_x);
    buf.extend_from_slice(&config.audit_pk_y);
    // Old balance ciphertext (from on-chain)
    buf.extend_from_slice(&ledger.balance_ct_lo);
    buf.extend_from_slice(&ledger.balance_ct_hi);
    // New balance ciphertext
    buf.extend_from_slice(&params.new_ct_lo);
    buf.extend_from_slice(&params.new_ct_hi);
    // Audit ciphertext
    buf.extend_from_slice(&params.audit_ct_lo);
    buf.extend_from_slice(&params.audit_ct_hi);
    // expected_version
    let mut ver_bytes = [0u8; 32];
    ver_bytes[..8].copy_from_slice(&(ledger.version + 1).to_le_bytes());
    buf.extend_from_slice(&ver_bytes);
    // is_sender = 0 for deposit
    buf.extend_from_slice(&[0u8; 32]);
    buf
}

fn invoke_verify_proof(
    zk_verifier: &AccountInfo,
    proof: &[u8; 256],
    pub_inputs: &[u8],
) -> Result<()> {
    let cpi_program = zk_verifier.clone();
    let cpi_accounts = zk_verifier::cpi::accounts::VerifyProof {
        _phantom: zk_verifier.clone(),
    };
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    zk_verifier::cpi::verify_balance_transition(
        cpi_ctx,
        *proof,
        pub_inputs.to_vec(),
    ).map_err(|e| {
        msg!("Deposit proof verification failed: {:?}", e);
        NexumError::ProofVerificationFailed
    })?;

    Ok(())
}
