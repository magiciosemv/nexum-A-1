pub mod alt_bn128;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("BpsDqXMPwPz8rpktTec4cnpCtxxj7J1nsU8F45KLVrEN");

#[program]
pub mod nexum_pool {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, params: InitializePoolParams) -> Result<()> {
        initialize_pool::handler(ctx, params)
    }

    pub fn create_user_ledger(ctx: Context<CreateUserLedger>) -> Result<()> {
        create_user_ledger::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, params: DepositParams) -> Result<()> {
        deposit::handler(ctx, params)
    }

    pub fn settle_atomic(ctx: Context<SettleAtomic>, params: SettleAtomicParams) -> Result<()> {
        settle_atomic::handler(ctx, params)
    }

    pub fn withdraw(ctx: Context<Withdraw>, params: WithdrawParams) -> Result<()> {
        withdraw::handler(ctx, params)
    }

    pub fn emergency_recover(ctx: Context<EmergencyRecover>, params: EmergencyRecoverParams) -> Result<()> {
        emergency_recover::handler(ctx, params)
    }
}
