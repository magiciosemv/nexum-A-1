use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;

declare_id!("6eDHCsfJxJyXvtoccuzrbHuHb8PZ21cVeppphC3Xem6H");

// ── State: Auditor Registry ─────────────────────────────────────────────────
#[account]
pub struct AuditorRegistry {
    pub admin: Pubkey,
    pub auditors: Vec<Pubkey>, // Registered auditor public keys
    pub bump: u8,
}

impl AuditorRegistry {
    pub const MAX_AUDITORS: usize = 32;
    pub const LEN: usize = 8 + 32 + 4 + (32 * Self::MAX_AUDITORS) + 1;
}

// ── State: Audit Log (permanent, never deleted) ────────────────────────────
#[account]
pub struct AuditLog {
    pub settlement_id: Pubkey,      // The settlement being audited
    pub auditor: Pubkey,            // Who requested the audit
    pub request_slot: u64,          // Block height at request time
    pub request_timestamp: i64,     // Unix timestamp
    pub reason_hash: [u8; 32],      // SHA-256 of audit reason (plaintext stored off-chain)
    pub jurisdiction: u8,           // 0=MAS, 1=SEC, 2=FCA, 3=OTHER
    pub bump: u8,
}

impl AuditLog {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 32 + 1 + 1;
}

// ── Error codes ─────────────────────────────────────────────────────────────
#[error_code]
pub enum AuditError {
    #[msg("Auditor not registered")]
    AuditorNotRegistered,
    #[msg("Auditor already registered")]
    AuditorAlreadyRegistered,
    #[msg("Only admin can register auditors")]
    Unauthorized,
    #[msg("Audit log already exists for this settlement")]
    AuditAlreadyExists,
}

// ── Instructions ────────────────────────────────────────────────────────────

#[program]
pub mod audit_gate {
    use super::*;

    /// Initialize the auditor registry (one-time)
    pub fn initialize_registry(ctx: Context<InitRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.auditor_registry;
        registry.admin = ctx.accounts.admin.key();
        registry.auditors = Vec::new();
        registry.bump = ctx.bumps.auditor_registry;
        Ok(())
    }

    /// Register a new auditor (admin only)
    pub fn register_auditor(ctx: Context<RegisterAuditor>) -> Result<()> {
        let registry = &mut ctx.accounts.auditor_registry;
        require!(
            ctx.accounts.admin.key() == registry.admin,
            AuditError::Unauthorized
        );
        require!(
            !registry.auditors.contains(&ctx.accounts.new_auditor.key()),
            AuditError::AuditorAlreadyRegistered
        );
        require!(
            registry.auditors.len() < AuditorRegistry::MAX_AUDITORS,
            AuditError::AuditorAlreadyRegistered
        );
        registry.auditors.push(ctx.accounts.new_auditor.key());
        msg!("Auditor registered: {}", ctx.accounts.new_auditor.key());
        Ok(())
    }

    /// Revoke an auditor (admin only)
    pub fn revoke_auditor(ctx: Context<RevokeAuditor>, auditor_to_revoke: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.auditor_registry;
        require!(
            ctx.accounts.admin.key() == registry.admin,
            AuditError::Unauthorized
        );
        let idx = registry.auditors.iter().position(|a| a == &auditor_to_revoke)
            .ok_or(AuditError::AuditorNotRegistered)?;
        registry.auditors.swap_remove(idx);
        msg!("Auditor revoked: {}", auditor_to_revoke);
        Ok(())
    }

    /// Request audit of a settlement (creates permanent on-chain record)
    pub fn request_audit(ctx: Context<RequestAudit>, params: RequestAuditParams) -> Result<()> {
        let registry = &ctx.accounts.auditor_registry;
        require!(
            registry.auditors.contains(&ctx.accounts.auditor.key()),
            AuditError::AuditorNotRegistered
        );

        let log = &mut ctx.accounts.audit_log;
        log.settlement_id = ctx.accounts.settlement_id.key();
        log.auditor = ctx.accounts.auditor.key();
        log.request_slot = Clock::get()?.slot;
        log.request_timestamp = Clock::get()?.unix_timestamp;
        log.reason_hash = params.reason_hash;
        log.jurisdiction = params.jurisdiction;
        log.bump = ctx.bumps.audit_log;

        msg!(
            "Audit requested: settlement {} by auditor {} (jurisdiction: {})",
            log.settlement_id,
            log.auditor,
            log.jurisdiction
        );
        Ok(())
    }
}

// ── Account contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + AuditorRegistry::LEN,
        seeds = [b"auditor_registry"],
        bump,
    )]
    pub auditor_registry: Account<'info, AuditorRegistry>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAuditor<'info> {
    #[account(
        mut,
        seeds = [b"auditor_registry"],
        bump = auditor_registry.bump,
    )]
    pub auditor_registry: Account<'info, AuditorRegistry>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: New auditor being registered
    pub new_auditor: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RevokeAuditor<'info> {
    #[account(
        mut,
        seeds = [b"auditor_registry"],
        bump = auditor_registry.bump,
    )]
    pub auditor_registry: Account<'info, AuditorRegistry>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(params: RequestAuditParams)]
pub struct RequestAudit<'info> {
    #[account(
        init,
        payer = auditor,
        space = 8 + AuditLog::LEN,
        seeds = [
            b"audit_log",
            settlement_id.key().as_ref(),
            auditor.key().as_ref(),
            &params.nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub audit_log: Account<'info, AuditLog>,

    /// CHECK: Settlement ID being audited
    pub settlement_id: AccountInfo<'info>,

    #[account(
        seeds = [b"auditor_registry"],
        bump = auditor_registry.bump,
    )]
    pub auditor_registry: Account<'info, AuditorRegistry>,

    #[account(mut)]
    pub auditor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RequestAuditParams {
    pub nonce: u64,
    pub reason_hash: [u8; 32],
    pub jurisdiction: u8,
}
