use anchor_lang::prelude::*;

#[account]
pub struct SettlementRecord {
    pub initiator: Pubkey,            // Party A address
    pub counterparty: Pubkey,         // Party B address
    pub asset_a_mint: Pubkey,         // Asset A mint
    pub asset_b_mint: Pubkey,         // Asset B mint
    // Party A audit ciphertexts (regulator can decrypt to get amounts)
    pub init_audit_ct_lo: [u8; 128],
    pub init_audit_ct_hi: [u8; 128],
    // Party B audit ciphertexts
    pub cp_audit_ct_lo: [u8; 128],
    pub cp_audit_ct_hi: [u8; 128],
    // ZK proofs (permanent archive for independent verification)
    pub init_zk_proof: [u8; 256],     // Groth16: A(64B) + B(128B) + C(64B)
    pub cp_zk_proof: [u8; 256],
    pub settled_at: i64,              // Unix timestamp
    pub bump: u8,
}

impl SettlementRecord {
    pub const LEN: usize = 8     // discriminator
        + 32 * 4                 // initiator + counterparty + asset_a_mint + asset_b_mint
        + 128 * 4                // 4 audit ciphertexts
        + 256 * 2                // 2 ZK proofs
        + 8                      // settled_at
        + 1;                     // bump
}
