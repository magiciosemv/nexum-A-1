/**
 * Nexum Protocol — Initialize Protocol on Devnet
 *
 * Run after deployment: npx ts-node scripts/init_protocol.ts
 *
 * This script:
 * 1. Initializes the ProtocolConfig PDA
 * 2. Sets the admin public key and audit key
 * 3. Creates demo user ledgers
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Configuration ─────────────────────────────────────────────────────────────
const CLUSTER = process.env.CLUSTER || "devnet";
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;

// Program IDs from Anchor.toml (devnet)
const NEXUM_POOL_ID = new PublicKey("DUkGn7AM3843JEPs9cJ658tbfsahsBph4htyqHQLc6");
const ZK_VERIFIER_ID = new PublicKey("7GS3tSuFc9W9dFgLzoz5XMxsmDDWYf7s6AJ6oQ5vqCg2");
const AUDIT_GATE_ID = new PublicKey("6HTRUo1nAKHUCjWD356kdzryBVv6nEX4z8PsaxBpYhBn");

// PDA seeds
const CONFIG_SEED = Buffer.from("nexum_config");
const LEDGER_SEED = Buffer.from("ledger");

async function main() {
  console.log("=== Nexum Protocol — Devnet Initialization ===\n");

  const connection = new Connection(RPC_URL, "confirmed");
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log("Payer:", payer.publicKey.toBase58());
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log("WARNING: Low balance. Requesting airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log("Airdrop confirmed.");
  }

  // ── Step 1: Find ProtocolConfig PDA ────────────────────────────────────────
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    NEXUM_POOL_ID
  );
  console.log("\nProtocolConfig PDA:", configPda.toBase58());

  // Check if already initialized
  const configInfo = await connection.getAccountInfo(configPda);
  if (configInfo) {
    console.log("ProtocolConfig already initialized. Skipping...");
  } else {
    console.log("Initializing ProtocolConfig...");
    // The initialize_pool instruction discriminator from IDL
    const INIT_DISCRIMINATOR = Buffer.from([95, 180, 10, 172, 84, 174, 232, 40]);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: NEXUM_POOL_ID,
      data: INIT_DISCRIMINATOR,
    });
    const tx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
    console.log("ProtocolConfig initialized! TX:", tx);
  }

  // ── Step 2: Create demo user ledgers ───────────────────────────────────────
  console.log("\n=== Creating Demo User Ledgers ===");

  // Generate demo keypairs
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  // Airdrop SOL to demo accounts
  for (const kp of [alice, bob]) {
    console.log("Funding", kp.publicKey.toBase58(), "...");
    try {
      const sig = await connection.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    } catch (e: any) {
      console.log("  Airdrop failed:", e.message?.slice(0, 60));
    }
  }

  // Create ledger discriminator from IDL
  const CREATE_LEDGER_DISC = Buffer.from([91, 133, 100, 35, 153, 179, 100, 42]);
  const mint = new PublicKey("So11111111111111111111111111111111111111112"); // Wrapped SOL

  for (const [name, kp] of [["Alice", alice], ["Bob", bob]]) {
    const [ledgerPda] = PublicKey.findProgramAddressSync(
      [LEDGER_SEED, kp.publicKey.toBuffer(), mint.toBuffer()],
      NEXUM_POOL_ID
    );

    const ledgerInfo = await connection.getAccountInfo(ledgerPda);
    if (ledgerInfo) {
      console.log(`${name}'s ledger already exists: ${ledgerPda.toBase58()}`);
      continue;
    }

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: ledgerPda, isSigner: false, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: kp.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: NEXUM_POOL_ID,
      data: CREATE_LEDGER_DISC,
    });

    try {
      const tx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [kp]);
      console.log(`${name}'s ledger created: ${ledgerPda.toBase58()}`);
      console.log("  TX:", tx);
    } catch (e: any) {
      console.log(`${name}'s ledger creation failed:`, e.message?.slice(0, 80));
    }
  }

  console.log("\n=== Initialization Complete ===");
  console.log("Alice:", alice.publicKey.toBase58());
  console.log("  Secret:", Buffer.from(alice.secretKey).toString("hex").slice(0, 16) + "...");
  console.log("Bob:", bob.publicKey.toBase58());
  console.log("  Secret:", Buffer.from(bob.secretKey).toString("hex").slice(0, 16) + "...");
}

main().catch(console.error);
