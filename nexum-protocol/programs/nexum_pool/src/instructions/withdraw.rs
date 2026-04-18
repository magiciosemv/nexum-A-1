use anchor_lang::prelude::*;
use crate::state::{UserLedger, ProtocolConfig, LedgerStatus};
use crate::constants::{LEDGER_SEED, NEXUM_CONFIG_SEED, TREASURY_SEED, ZK_VERIFIER_ID, SPL_TOKEN_ID};
use crate::error::NexumError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawParams {
    pub proof: [u8; 256],
    pub new_ct_lo: [u8; 128],
    pub new_ct_hi: [u8; 128],
    pub audit_ct_lo: [u8; 128],
    pub audit_ct_hi: [u8; 128],
    pub amount: u64,
}

#[derive(Accounts)]
#[instruction(params: WithdrawParams)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [LEDGER_SEED, withdrawer.key().as_ref(), mint.key().as_ref()],
        bump = user_ledger.bump,
        constraint = user_ledger.status == LedgerStatus::Active @ NexumError::LedgerNotActive,
        constraint = user_ledger.owner == withdrawer.key() @ NexumError::OwnerMismatch,
    )]
    pub user_ledger: Account<'info, UserLedger>,

    #[account(
        seeds = [NEXUM_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = !protocol_config.is_paused @ NexumError::ProtocolPaused,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: Treasury vault PDA (signer via seeds for CPI)
    #[account(
        mut,
        seeds = [TREASURY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub treasury_vault: AccountInfo<'info>,

    /// CHECK: Mint account — validated against user_ledger.mint
    #[account(constraint = mint.key() == user_ledger.mint @ NexumError::MintMismatch)]
    pub mint: AccountInfo<'info>,

    /// CHECK: Treasury's associated token account — validated in handler
    #[account(mut)]
    pub treasury_ata: AccountInfo<'info>,

    /// CHECK: Withdrawer's associated token account — validated in handler
    #[account(mut)]
    pub withdrawer_ata: AccountInfo<'info>,

    /// CHECK: SPL Token program — validated against known program ID
    #[account(constraint = token_program.key() == SPL_TOKEN_ID @ NexumError::TokenProgramMismatch)]
    pub token_program: AccountInfo<'info>,

    #[account(mut)]
    pub withdrawer: Signer<'info>,

    /// CHECK: ZK verifier program — validated against known program ID
    #[account(constraint = zk_verifier.key() == ZK_VERIFIER_ID @ NexumError::ZkVerifierMismatch)]
    pub zk_verifier: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, params: WithdrawParams) -> Result<()> {
    // Step 0: Validate token account ownership — treasury_ata and withdrawer_ata
    // must be owned by the SPL Token program
    require!(
        *ctx.accounts.treasury_ata.owner == ctx.accounts.token_program.key(),
        NexumError::TokenProgramMismatch
    );
    require!(
        *ctx.accounts.withdrawer_ata.owner == ctx.accounts.token_program.key(),
        NexumError::TokenProgramMismatch
    );

    // Step 1: Verify withdrawal ZK proof via CPI
    invoke_verify_proof(
        &ctx.accounts.zk_verifier,
        &params.proof,
        &build_withdraw_pub_inputs(&ctx.accounts.user_ledger, &ctx.accounts.protocol_config, &params),
    )?;

    // Step 2: SPL Token transfer from Treasury ATA to Withdrawer ATA
    let amount = params.amount;
    if amount > 0 {
        // Derive treasury bump from seeds
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

        let mut data = Vec::with_capacity(9);
        data.push(12u8); // Transfer discriminator
        data.extend_from_slice(&amount.to_le_bytes());

        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.treasury_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.withdrawer_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.treasury_vault.key(), true
                ),
            ],
            data,
        };

        let signer_seeds = &[treasury_seeds];
        anchor_lang::solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.treasury_ata.clone(),
                ctx.accounts.withdrawer_ata.clone(),
                ctx.accounts.treasury_vault.clone(),
                ctx.accounts.token_program.clone(),
            ],
            signer_seeds,
        ).map_err(|e| {
            msg!("SPL Token transfer failed: {:?}", e);
            NexumError::AltBn128Error
        })?;
    }

    // Step 3: Update ledger with new encrypted balance
    let ledger = &mut ctx.accounts.user_ledger;
    ledger.balance_ct_lo = params.new_ct_lo;
    ledger.balance_ct_hi = params.new_ct_hi;
    ledger.audit_ct_lo = params.audit_ct_lo;
    ledger.audit_ct_hi = params.audit_ct_hi;
    ledger.version += 1;

    msg!(
        "withdraw: {} | amount: {} | ledger version: {}",
        ctx.accounts.withdrawer.key(),
        amount,
        ledger.version
    );

    Ok(())
}

fn build_withdraw_pub_inputs(ledger: &UserLedger, config: &ProtocolConfig, params: &WithdrawParams) -> Vec<u8> {
    let mut buf = Vec::with_capacity(960);
    let owner_bytes = ledger.owner.as_ref();
    buf.extend_from_slice(&owner_bytes[..32]); // pk_x
    buf.extend_from_slice(&owner_bytes[..32]); // pk_y (simplified)
    buf.extend_from_slice(&config.audit_pk_x);
    buf.extend_from_slice(&config.audit_pk_y);
    buf.extend_from_slice(&ledger.balance_ct_lo);
    buf.extend_from_slice(&ledger.balance_ct_hi);
    buf.extend_from_slice(&params.new_ct_lo);
    buf.extend_from_slice(&params.new_ct_hi);
    buf.extend_from_slice(&params.audit_ct_lo);
    buf.extend_from_slice(&params.audit_ct_hi);
    let mut ver_bytes = [0u8; 32];
    ver_bytes[..8].copy_from_slice(&(ledger.version + 1).to_le_bytes());
    buf.extend_from_slice(&ver_bytes);
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
        msg!("Withdraw proof verification failed: {:?}", e);
        NexumError::ProofVerificationFailed
    })?;

    Ok(())
}
