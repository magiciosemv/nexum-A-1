use anchor_lang::prelude::*;
use crate::state::{UserLedger, ProtocolConfig, LedgerStatus};
use crate::constants::{LEDGER_SEED, NEXUM_CONFIG_SEED, TREASURY_SEED, SPL_TOKEN_ID};
use crate::error::NexumError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EmergencyRecoverParams {
    /// The amount of SPL tokens to return to the user (admin-verified)
    pub amount: u64,
}

#[derive(Accounts)]
#[instruction(params: EmergencyRecoverParams)]
pub struct EmergencyRecover<'info> {
    /// Protocol admin must authorize recovery
    #[account(
        seeds = [NEXUM_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = protocol_config.admin == admin.key() @ NexumError::InvalidAuditor,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// The ledger to recover — must be in Emergency state
    #[account(
        mut,
        seeds = [LEDGER_SEED, ledger.owner.as_ref(), ledger.mint.as_ref()],
        bump = ledger.bump,
        constraint = ledger.status == LedgerStatus::Emergency @ NexumError::LedgerNotActive,
    )]
    pub ledger: Account<'info, UserLedger>,

    /// CHECK: Treasury vault PDA (signer via seeds for SPL transfer)
    #[account(
        mut,
        seeds = [TREASURY_SEED, ledger.mint.as_ref()],
        bump,
    )]
    pub treasury_vault: AccountInfo<'info>,

    /// CHECK: Mint account
    pub mint: AccountInfo<'info>,

    /// CHECK: Treasury's associated token account — source of SPL tokens
    #[account(mut)]
    pub treasury_ata: AccountInfo<'info>,

    /// CHECK: User's associated token account — destination for recovered tokens
    #[account(mut)]
    pub user_ata: AccountInfo<'info>,

    /// CHECK: SPL Token program — validated against known program ID
    #[account(constraint = token_program.key() == SPL_TOKEN_ID @ NexumError::TokenProgramMismatch)]
    pub token_program: AccountInfo<'info>,

    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EmergencyRecover>, params: EmergencyRecoverParams) -> Result<()> {
    // Extract ledger fields before mutable borrow
    let mint_key = ctx.accounts.ledger.mint;
    let ledger_owner = ctx.accounts.ledger.owner;

    // Step 1: Transfer SPL tokens from treasury_ata to user_ata
    // The amount is admin-verified (admin signs the transaction)
    let amount = params.amount;
    if amount > 0 {
        // Validate token accounts are owned by SPL Token program
        require!(
            *ctx.accounts.treasury_ata.owner == ctx.accounts.token_program.key(),
            NexumError::TokenProgramMismatch
        );
        require!(
            *ctx.accounts.user_ata.owner == ctx.accounts.token_program.key(),
            NexumError::TokenProgramMismatch
        );

        // Derive treasury PDA signer seeds
        let (_, treasury_bump) = Pubkey::find_program_address(
            &[TREASURY_SEED, mint_key.as_ref()],
            &crate::ID,
        );
        let bump_bytes = [treasury_bump];
        let treasury_seeds: &[&[u8]] = &[
            TREASURY_SEED,
            mint_key.as_ref(),
            &bump_bytes,
        ];

        let mut data = Vec::with_capacity(9);
        data.push(12u8); // Transfer discriminator for SPL Token
        data.extend_from_slice(&amount.to_le_bytes());

        let transfer_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ctx.accounts.token_program.key(),
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.treasury_ata.key(), false
                ),
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.user_ata.key(), false
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
                ctx.accounts.user_ata.clone(),
                ctx.accounts.treasury_vault.clone(),
                ctx.accounts.token_program.clone(),
            ],
            signer_seeds,
        ).map_err(|e| {
            msg!("Emergency SPL Token transfer failed: {:?}", e);
            NexumError::AltBn128Error
        })?;

        msg!(
            "emergency_recover: transferred {} tokens from treasury to user {}",
            amount,
            ledger_owner
        );
    }

    // Step 2: Clear encrypted balance to zero-ciphertext (all zeros = zero balance)
    let ledger = &mut ctx.accounts.ledger;
    ledger.balance_ct_lo = [0u8; 128];
    ledger.balance_ct_hi = [0u8; 128];
    ledger.audit_ct_lo = [0u8; 128];
    ledger.audit_ct_hi = [0u8; 128];

    // Step 3: Transition ledger back to Active
    ledger.status = LedgerStatus::Active;
    ledger.version += 1;

    msg!(
        "emergency_recover: ledger {} recovered to Active by admin {} | amount: {}",
        ledger.key(),
        ctx.accounts.admin.key(),
        amount
    );

    Ok(())
}
