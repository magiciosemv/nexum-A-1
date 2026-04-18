use anchor_lang::prelude::*;
use crate::state::{UserLedger, ProtocolConfig, LedgerStatus};
use crate::constants::{LEDGER_SEED, NEXUM_CONFIG_SEED};
use crate::error::NexumError;

#[derive(Accounts)]
#[instruction()]
pub struct CreateUserLedger<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + UserLedger::LEN,
        seeds = [LEDGER_SEED, owner.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub user_ledger: Account<'info, UserLedger>,
    #[account(
        seeds = [NEXUM_CONFIG_SEED],
        bump = protocol_config.bump,
        constraint = !protocol_config.is_paused @ NexumError::ProtocolPaused,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    /// CHECK: Verified by constraints
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateUserLedger>) -> Result<()> {
    let ledger = &mut ctx.accounts.user_ledger;
    ledger.owner = ctx.accounts.owner.key();
    ledger.mint = ctx.accounts.mint.key();
    ledger.balance_ct_lo = [0u8; 128];
    ledger.balance_ct_hi = [0u8; 128];
    ledger.audit_ct_lo = [0u8; 128];
    ledger.audit_ct_hi = [0u8; 128];
    ledger.version = 0;
    ledger.status = LedgerStatus::Active;
    ledger.last_settlement_id = [0u8; 32];
    ledger.bump = ctx.bumps.user_ledger;

    msg!("User ledger created for: {}", ctx.accounts.owner.key());
    Ok(())
}
