use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum LedgerStatus {
    Active,
    PendingSettle,  // Reserved for future use (Plan B)
    Emergency,
}

impl Default for LedgerStatus {
    fn default() -> Self {
        LedgerStatus::Active
    }
}

#[account]
pub struct UserLedger {
    pub owner: Pubkey,             // Ledger owner's Solana address
    pub mint: Pubkey,              // Asset Mint address (USDC/SOL etc.)
    // Encrypted balance (Baby Jubjub ElGamal)
    pub balance_ct_lo: [u8; 128],  // Balance low 32-bit ciphertext (C1.xy + C2.xy)
    pub balance_ct_hi: [u8; 128],  // Balance high 32-bit ciphertext
    // Audit ciphertexts from latest settlement (for regulatory audit)
    pub audit_ct_lo: [u8; 128],
    pub audit_ct_hi: [u8; 128],
    pub version: u64,              // Monotonically increasing, prevents replay
    pub status: LedgerStatus,
    pub last_settlement_id: [u8; 32], // Last settlement ID (audit traceability)
    pub bump: u8,
}

impl UserLedger {
    pub const LEN: usize = 8     // discriminator
        + 32 + 32                // owner + mint
        + 128 * 4                // 4 ciphertext fields (balance_lo/hi, audit_lo/hi)
        + 8                      // version
        + 1                      // status
        + 32                     // last_settlement_id
        + 1;                     // bump
}
