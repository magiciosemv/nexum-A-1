use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,           // Protocol admin (multisig recommended)
    pub audit_pk_x: [u8; 32],   // Audit public key x-coordinate (Baby Jubjub)
    pub audit_pk_y: [u8; 32],   // Audit public key y-coordinate
    pub fee_bps: u64,            // Settlement fee in basis points (10 = 0.1%)
    pub is_paused: bool,         // Emergency pause (stops new deposits only)
    pub bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 8    // discriminator
        + 32                    // admin
        + 32 + 32               // audit_pk_x + audit_pk_y
        + 8                     // fee_bps
        + 1                     // is_paused
        + 1;                    // bump
}
