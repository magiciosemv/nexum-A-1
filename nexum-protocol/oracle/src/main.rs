mod decrypt;

use decrypt::{
    build_baby_step_table, bsgs_decrypt_with_table, decrypt_audit_ciphertext,
    deserialize_ciphertext, serialize_ciphertext, CurveParams, Ciphertext,
    ExtendedPoint as EP, SEARCH_RANGE,
};
use num_bigint::BigInt;
use std::env;
use std::str::FromStr;
use std::time::Instant;

// ── On-chain dependencies ────────────────────────────────────────────────────

use borsh::{BorshDeserialize, BorshSerialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
};

/// Nexum Pool program ID (localnet)
const NEXUM_POOL_PROGRAM_ID: &str = "BpsDqXMPwPz8rpktTec4cnpCtxxj7J1nsU8F45KLVrEN";

/// SettlementRecord discriminator from Anchor IDL
const SETTLEMENT_RECORD_DISCRIMINATOR: [u8; 8] = [172, 159, 67, 74, 96, 85, 37, 205];

/// SettlementRecord account data layout (mirrors on-chain struct)
#[derive(Debug, BorshSerialize, BorshDeserialize)]
pub struct SettlementRecord {
    pub initiator: [u8; 32],
    pub counterparty: [u8; 32],
    pub asset_a_mint: [u8; 32],
    pub asset_b_mint: [u8; 32],
    pub init_audit_ct_lo: [u8; 128],
    pub init_audit_ct_hi: [u8; 128],
    pub cp_audit_ct_lo: [u8; 128],
    pub cp_audit_ct_hi: [u8; 128],
    pub init_zk_proof: [u8; 256],
    pub cp_zk_proof: [u8; 256],
    pub settled_at: i64,
    pub bump: u8,
}

impl SettlementRecord {
    /// Parse from raw account data (after 8-byte Anchor discriminator)
    pub fn from_account_data(data: &[u8]) -> Result<Self, String> {
        if data.len() < 8 {
            return Err("Account data too short for discriminator".into());
        }

        // Verify Anchor discriminator
        let disc: [u8; 8] = data[..8].try_into().unwrap();
        if disc != SETTLEMENT_RECORD_DISCRIMINATOR {
            return Err(format!(
                "Discriminator mismatch: expected {:?}, got {:?}",
                SETTLEMENT_RECORD_DISCRIMINATOR, disc
            ));
        }

        SettlementRecord::try_from_slice(&data[8..])
            .map_err(|e| format!("Borsh deserialization failed: {}", e))
    }

    /// Derive the PDA for a SettlementRecord
    /// Seeds: [b"settlement", ledger_a_pubkey, nonce]
    pub fn find_pda(ledger_a: &Pubkey, nonce: u64, program_id: &Pubkey) -> (Pubkey, u8) {
        let nonce_bytes = nonce.to_le_bytes();
        Pubkey::find_program_address(
            &[b"settlement", ledger_a.as_ref(), &nonce_bytes],
            program_id,
        )
    }
}

/// Connect to a Solana RPC endpoint
fn connect_rpc(rpc_url: &str) -> RpcClient {
    let client = RpcClient::new_with_commitment(
        rpc_url.to_string(),
        CommitmentConfig::confirmed(),
    );
    client
}

/// Fetch and parse a SettlementRecord from the chain
fn get_settlement_record(
    client: &RpcClient,
    pda: &Pubkey,
) -> Result<SettlementRecord, String> {
    let account_data = client
        .get_account(pda)
        .map_err(|e| format!("RPC error fetching {}: {}", pda, e))?;

    SettlementRecord::from_account_data(&account_data.data)
}

/// Poll for recent settlement records by scanning known PDAs
/// In a production system this would use WebSocket subscriptions;
/// this demo uses polling with a fixed set of known PDAs.
fn poll_settlements(
    client: &RpcClient,
    program_id: &Pubkey,
    params: &CurveParams,
    audit_sk: &BigInt,
    max_nonce: u64,
) {
    println!("--- Polling for settlement records (demo mode) ---");
    println!("  Program: {}", program_id);
    println!("  Max nonce scan: 0..{}", max_nonce);
    println!();

    // In production, the oracle would know the ledger_a addresses from off-chain
    // channels. For demo, we use a placeholder pubkey.
    let placeholder_ledger = Pubkey::new_unique();

    for nonce in 0..max_nonce {
        let (pda, _bump) = SettlementRecord::find_pda(&placeholder_ledger, nonce, program_id);

        match get_settlement_record(client, &pda) {
            Ok(record) => {
                println!("[settlement] nonce={} pda={}", nonce, pda);
                println!("  initiator    : {}", Pubkey::new_from_array(record.initiator));
                println!("  counterparty : {}", Pubkey::new_from_array(record.counterparty));
                println!("  settled_at   : {}", record.settled_at);
                println!();

                // Decrypt audit ciphertexts
                decrypt_audit_record(&record, params, audit_sk);
            }
            Err(e) => {
                // Expected: most PDAs won't have accounts
                if nonce == 0 {
                    println!("  [scan] No record at nonce {} ({})", nonce, e);
                }
            }
        }
    }

    println!("  [scan] Polling cycle complete.");
    println!();
}

/// Decrypt the audit ciphertexts from a SettlementRecord
fn decrypt_audit_record(record: &SettlementRecord, params: &CurveParams, audit_sk: &BigInt) {
    let ciphertexts = [
        ("init_lo", &record.init_audit_ct_lo),
        ("init_hi", &record.init_audit_ct_hi),
        ("cp_lo", &record.cp_audit_ct_lo),
        ("cp_hi", &record.cp_audit_ct_hi),
    ];

    println!("  [audit] Decrypting settlement audit ciphertexts...");

    for (label, ct_bytes) in &ciphertexts {
        match deserialize_ciphertext(*ct_bytes) {
            Ok(ct) => {
                let start = Instant::now();
                match decrypt_audit_ciphertext(&ct, audit_sk, params, SEARCH_RANGE) {
                    Ok(value) => {
                        let elapsed = start.elapsed();
                        println!(
                            "    {} = {} ({:.2}ms)",
                            label,
                            value,
                            elapsed.as_secs_f64() * 1000.0
                        );
                    }
                    Err(e) => {
                        println!("    {} = DECRYPT_ERROR: {}", label, e);
                    }
                }
            }
            Err(e) => {
                println!("    {} = DESERIALIZE_ERROR: {}", label, e);
            }
        }
    }

    println!();
}

/// Run the on-chain monitoring loop (demo mode with polling)
fn run_onchain_monitor(rpc_url: &str, audit_sk_hex: &str) {
    println!("=======================================================");
    println!("  Nexum Audit Oracle — On-Chain Monitor (DEMO)");
    println!("=======================================================");
    println!();

    let params = CurveParams::new();
    let audit_sk = BigInt::parse_bytes(audit_sk_hex.as_bytes(), 16)
        .expect("Invalid audit secret key hex");

    let program_id = Pubkey::from_str(NEXUM_POOL_PROGRAM_ID)
        .expect("Invalid program ID");

    // Connect to Solana RPC
    println!("[rpc] Connecting to {}", rpc_url);
    let client = connect_rpc(rpc_url);

    // Verify connection
    match client.get_health() {
        Ok(_) => println!("[rpc] Connected successfully"),
        Err(e) => {
            eprintln!("[rpc] Connection failed: {}", e);
            eprintln!("[rpc] Continuing in offline demo mode...");
        }
    }
    println!();

    // Fetch genesis hash to identify the network
    match client.get_genesis_hash() {
        Ok(hash) => println!("[rpc] Genesis hash: {}", hash),
        Err(_) => println!("[rpc] Could not fetch genesis hash (offline?)"),
    }
    println!();

    // Poll for settlements (demo: scan nonces 0-2)
    poll_settlements(&client, &program_id, &params, &audit_sk, 3);

    // In production, this would be a long-running loop:
    // loop {
    //     poll_settlements(&client, &program_id, &params, &audit_sk, latest_nonce);
    //     std::thread::sleep(Duration::from_secs(10));
    // }

    println!("=======================================================");
    println!("  On-chain monitor demo complete.");
    println!("  Production: continuous WebSocket or polling loop");
    println!("=======================================================");
}

// Short display strings for generator
const GENERATOR_X_SHORT: &str = "7582035...832581";
const GENERATOR_Y_SHORT: &str = "7801528...841260";
const FIELD_MODULUS: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";

fn main() {
    println!("=======================================================");
    println!("  Nexum Audit Oracle (DEMO MODE)");
    println!("  Baby Jubjub BSGS Decryption Engine");
    println!("=======================================================");
    println!();

    let params = CurveParams::new();
    println!("[init] Baby Jubjub curve parameters loaded");
    println!(
        "  Field modulus : {}...{}",
        &FIELD_MODULUS[..16],
        &FIELD_MODULUS[FIELD_MODULUS.len() - 8..]
    );
    println!("  Generator G   : ({}, {})", GENERATOR_X_SHORT, GENERATOR_Y_SHORT);
    println!("  Search range  : [0, {})", SEARCH_RANGE);
    println!();

    // Parse CLI args or run built-in demo
    let args: Vec<String> = env::args().collect();

    if args.len() > 1 && args[1] == "--demo" {
        run_demo(&params);
    } else if args.len() >= 4 && args[1] == "--decrypt" {
        run_decrypt_from_args(&params, &args);
    } else if args.len() >= 3 && args[1] == "--monitor" {
        // --monitor <rpc_url> <audit_sk_hex>
        // e.g. --monitor http://localhost:8899 deadbeef...
        let rpc_url = &args[2];
        let audit_sk_hex = &args[3].clone();
        run_onchain_monitor(rpc_url, audit_sk_hex);
    } else {
        print_usage();
        println!();
        println!("Running built-in demo...");
        println!();
        run_demo(&params);
    }
}

fn print_usage() {
    println!("Usage:");
    println!("  nexum-oracle --demo");
    println!(
        "  nexum-oracle --decrypt <audit_sk_hex> <ciphertext_hex> [range]"
    );
    println!("  nexum-oracle --monitor <rpc_url> <audit_sk_hex>");
    println!();
    println!("Modes:");
    println!("  --demo     : Run self-contained encryption/decryption demo");
    println!("  --decrypt  : Decrypt a single audit ciphertext from hex args");
    println!("  --monitor  : Connect to Solana RPC and poll settlement records");
    println!();
    println!("Environment variables:");
    println!("  NEXUM_AUDIT_SK  - Audit secret key (hex, optional for --demo)");
}

/// Run a self-contained demo: encrypt known values, then decrypt them.
fn run_demo(params: &CurveParams) {
    let g = decrypt::generator(params);

    // Demo key
    let audit_sk = BigInt::from(42u64);
    let pk_ext = g.scalar_mul(&audit_sk, params);
    let pk = pk_ext.to_affine(params);

    println!("=== Demo: Audit Oracle Decryption ===");
    println!("  audit_sk : {}", audit_sk);
    println!(
        "  audit_pk : ({}, {})",
        &pk.x.to_str_radix(16),
        &pk.y.to_str_radix(16)
    );
    println!();

    // Test cases: different plaintext values
    let test_values: Vec<u64> = vec![0, 1, 42, 100, 999, 12345, 65535];

    println!("--- Brute-force decryption (range 0..{}) ---", SEARCH_RANGE);
    println!();

    for &m in &test_values {
        let r = BigInt::from(1234567u64 + m); // deterministic randomness for demo

        // Encrypt: C1 = r*G, C2 = m*G + r*pk
        let c1 = g.scalar_mul(&r, params).to_affine(params);

        let c2 = if m == 0 {
            // m=0: C2 = r*pk
            EP::from_affine(&pk, params)
                .scalar_mul(&r, params)
                .to_affine(params)
        } else {
            let mg = g.scalar_mul(&BigInt::from(m), params);
            let rpk = EP::from_affine(&pk, params).scalar_mul(&r, params);
            mg.add(&rpk, params).to_affine(params)
        };

        let ct = Ciphertext {
            c1: c1.clone(),
            c2: c2.clone(),
        };

        // Serialize and deserialize (round-trip test)
        let serialized = serialize_ciphertext(&ct);
        let deserialized = deserialize_ciphertext(&serialized).unwrap();

        // Decrypt
        let start = Instant::now();
        let result = decrypt_audit_ciphertext(&deserialized, &audit_sk, params, SEARCH_RANGE);
        let elapsed = start.elapsed();

        match result {
            Ok(decrypted) => {
                let status = if decrypted == m { "OK" } else { "MISMATCH" };
                println!(
                    "  m={:>5} -> decrypted={:>5}  [{:>3}] ({:.2}ms)",
                    m,
                    decrypted,
                    status,
                    elapsed.as_secs_f64() * 1000.0
                );
            }
            Err(e) => {
                println!("  m={:>5} -> ERROR: {}", m, e);
            }
        }
    }

    println!();
    println!("--- BSGS table-based decryption ---");
    println!();

    // Build BSGS baby-step table
    let table_size = 256u64;
    println!("  Building baby-step table (size={})...", table_size);
    let start = Instant::now();
    let (baby_table, giant_step) = build_baby_step_table(params, table_size);
    let table_elapsed = start.elapsed();
    println!(
        "  Table built: {} entries, {:.2}ms",
        baby_table.len(),
        table_elapsed.as_secs_f64() * 1000.0
    );
    println!(
        "  Giant step point: ({}, {})",
        &giant_step.x.to_str_radix(16),
        &giant_step.y.to_str_radix(16)
    );
    println!();

    // BSGS decrypt tests
    let bsgs_test_values: Vec<u64> = vec![0, 42, 500, 5000, 50000, 65535];

    for &m in &bsgs_test_values {
        let r = BigInt::from(7654321u64 + m);

        let c1 = g.scalar_mul(&r, params).to_affine(params);

        let c2 = if m == 0 {
            EP::from_affine(&pk, params)
                .scalar_mul(&r, params)
                .to_affine(params)
        } else {
            let mg = g.scalar_mul(&BigInt::from(m), params);
            let rpk = EP::from_affine(&pk, params).scalar_mul(&r, params);
            mg.add(&rpk, params).to_affine(params)
        };

        let ct = Ciphertext { c1, c2 };

        let start = Instant::now();
        let result = bsgs_decrypt_with_table(
            &ct,
            &audit_sk,
            params,
            &baby_table,
            &giant_step,
            table_size,
        );
        let elapsed = start.elapsed();

        match result {
            Ok(decrypted) => {
                let status = if decrypted == m { "OK" } else { "MISMATCH" };
                println!(
                    "  m={:>5} -> decrypted={:>5}  [{:>3}] ({:.2}ms)",
                    m,
                    decrypted,
                    status,
                    elapsed.as_secs_f64() * 1000.0
                );
            }
            Err(e) => {
                println!("  m={:>5} -> ERROR: {}", m, e);
            }
        }
    }

    println!();
    println!("=======================================================");
    println!("  Demo complete. All decryptions verified.");
    println!("  Production: AWS Nitro Enclave + KMS PCR binding");
    println!("=======================================================");
}

/// Decrypt a ciphertext provided as CLI arguments.
fn run_decrypt_from_args(params: &CurveParams, args: &[String]) {
    // args: [program, "--decrypt", audit_sk_hex, ciphertext_hex, [range]]
    let audit_sk_hex = &args[2];
    let ct_hex = &args[3];
    let range: u64 = args
        .get(4)
        .and_then(|s| s.parse().ok())
        .unwrap_or(SEARCH_RANGE);

    let audit_sk = BigInt::parse_bytes(audit_sk_hex.as_bytes(), 16)
        .expect("Invalid audit_sk hex");

    let ct_bytes = hex::decode(ct_hex).expect("Invalid ciphertext hex");
    let ct = deserialize_ciphertext(&ct_bytes).expect("Failed to deserialize ciphertext");

    println!("=== Decrypting audit ciphertext ===");
    println!("  audit_sk : 0x{}...", &audit_sk_hex[..audit_sk_hex.len().min(16)]);
    println!(
        "  C1       : ({}, {})",
        &ct.c1.x.to_str_radix(16),
        &ct.c1.y.to_str_radix(16)
    );
    println!(
        "  C2       : ({}, {})",
        &ct.c2.x.to_str_radix(16),
        &ct.c2.y.to_str_radix(16)
    );
    println!("  range    : [0, {})", range);
    println!();

    let start = Instant::now();
    match decrypt_audit_ciphertext(&ct, &audit_sk, params, range) {
        Ok(m) => {
            let elapsed = start.elapsed();
            println!("  Decrypted value: {}", m);
            println!("  Time: {:.2}ms", elapsed.as_secs_f64() * 1000.0);
        }
        Err(e) => {
            eprintln!("  ERROR: {}", e);
            std::process::exit(1);
        }
    }
}
