use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::constants::NEXUM_CONFIG_SEED;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePoolParams {
    pub audit_pk_x: [u8; 32],
    pub audit_pk_y: [u8; 32],
    pub fee_bps: u64,
}

#[derive(Accounts)]
#[instruction(params: InitializePoolParams)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::LEN,
        seeds = [NEXUM_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
    let config = &mut ctx.accounts.protocol_config;
    config.admin = ctx.accounts.admin.key();
    config.audit_pk_x = params.audit_pk_x;
    config.audit_pk_y = params.audit_pk_y;
    config.fee_bps = params.fee_bps;
    config.is_paused = false;
    config.bump = ctx.bumps.protocol_config;

    msg!("Protocol initialized with fee: {}bps", params.fee_bps);
    Ok(())
}
