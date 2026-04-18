use anchor_lang::prelude::*;

#[error_code]
pub enum NexumError {
    #[msg("Ledger is not in Active status")]
    LedgerNotActive,

    #[msg("Cannot settle a ledger with itself")]
    SameLedger,

    #[msg("Asset mint mismatch between ledgers")]
    MintMismatch,

    #[msg("ZK proof verification failed")]
    ZkVerificationFailed,

    #[msg("Version mismatch: proof is stale or replayed")]
    VersionMismatch,

    #[msg("Transfer amounts in audit ciphertexts are inconsistent")]
    TransferAmountMismatch,

    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Insufficient balance")]
    InsufficientBalance,

    #[msg("Invalid auditor: not registered or revoked")]
    InvalidAuditor,

    #[msg("alt_bn128 syscall error")]
    AltBn128Error,

    #[msg("ZK proof CPI verification failed")]
    ProofVerificationFailed,

    #[msg("Invalid token program: must be SPL Token")]
    TokenProgramMismatch,

    #[msg("Invalid ZK verifier program")]
    ZkVerifierMismatch,

    #[msg("Ledger owner does not match signer")]
    OwnerMismatch,
}
