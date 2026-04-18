import { useState, useCallback, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TerminalWindow } from "../components/TerminalWindow";
import { LedgerView } from "../components/LedgerView";
import { settleAtomic, estimateSettleCu } from "../lib/contract";
import { DEFAULT_MINT } from "../lib/constants";
import { useWorkers } from "../hooks/useWorkers";
import type { WorkerStatus } from "../hooks/useWorkers";
import type { SettleAtomicParams } from "../types/anchor";
import { deriveKeyPairFromWalletSignature } from "../../../sdk/dist/crypto/keys";
import type { Point } from "../../../sdk/dist/crypto/elgamal";

type Step = "idle" | "proving" | "submitting" | "done";

export default function SettlePage() {
  const { publicKey, signTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [counterpartyPk, setCounterpartyPk] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [result, setResult] = useState<{ sig: string; cu: number; slot: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Baby Jubjub keypair derived from wallet signature
  const [bjjSk, setBjjSk] = useState<string | null>(null);
  const [bjjPk, setBjjPk] = useState<Point | null>(null);
  const [keyDeriving, setKeyDeriving] = useState(false);

  // Latest ciphertext data for LedgerView decryption
  const [latestCtLo, setLatestCtLo] = useState<Uint8Array | null>(null);
  const [latestCtHi, setLatestCtHi] = useState<Uint8Array | null>(null);

  const appendLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-50), msg]);
  }, []);

  const {
    isReady,
    cryptoStatus,
    proverStatus,
    provingPct,
    encrypt,
    generateProof,
    decryptBalance,
  } = useWorkers(appendLog);

  // Derive Baby Jubjub keypair from wallet signature when wallet connects
  useEffect(() => {
    if (!publicKey || !signMessage || bjjSk) return;

    let cancelled = false;
    setKeyDeriving(true);
    appendLog("[KeyDerive] Requesting wallet signature for Baby Jubjub key derivation...");

    const message = new TextEncoder().encode("nexum_baby_jub_key_v1");
    signMessage(message)
      .then(async (signature) => {
        if (cancelled) return;
        const keypair = await deriveKeyPairFromWalletSignature(signature);
        if (cancelled) return;
        setBjjSk(keypair.sk.toString());
        setBjjPk(keypair.pk);
        appendLog("[KeyDerive] Baby Jubjub keypair derived successfully");
        appendLog("[KeyDerive] PK: (" + keypair.pk.x.toString().slice(0, 12) + "..., " + keypair.pk.y.toString().slice(0, 12) + "...)");
        setKeyDeriving(false);
      })
      .catch((err: any) => {
        if (cancelled) return;
        appendLog("[KeyDerive] Failed: " + (err.message || "User rejected or wallet does not support signMessage"));
        setKeyDeriving(false);
      });

    return () => { cancelled = true; };
  }, [publicKey, signMessage, bjjSk, appendLog]);

  async function handleSettle() {
    if (!publicKey || !signTransaction || !isReady) return;
    const amount = parseInt(transferAmount);
    if (isNaN(amount) || amount <= 0) return;

    // Validate counterparty public key
    let counterparty: PublicKey;
    try {
      counterparty = new PublicKey(counterpartyPk.trim());
    } catch {
      appendLog("[ERROR] Invalid counterparty public key");
      return;
    }

    if (counterparty.equals(publicKey)) {
      appendLog("[ERROR] Counterparty must be different from your wallet");
      return;
    }

    setStep("proving");
    appendLog("[SDK] Starting settlement proof generation...");

    try {
      // Step 1: Request encryption from CryptoWorker
      appendLog("[CryptoWorker] Encrypting transfer amount: " + amount);
      appendLog("[CryptoWorker] Counterparty: " + counterparty.toBase58().slice(0, 12) + "...");
      const cryptoResult = await encrypt({
        amount,
        recipient: counterparty.toBase58(),
      });
      appendLog("[CryptoWorker] Encryption complete");

      // Store ciphertext for LedgerView decryption
      if (cryptoResult.new_ct_lo) {
        setLatestCtLo(new Uint8Array(cryptoResult.new_ct_lo));
      }
      if (cryptoResult.new_ct_hi) {
        setLatestCtHi(new Uint8Array(cryptoResult.new_ct_hi));
      }

      // Step 2: Generate ZK proof via ProverWorker
      appendLog("[ProverWorker] Generating Groth16 proof...");
      const proveResult = await generateProof({
        input: cryptoResult.input,
      });
      appendLog("[ProverWorker] Proof generated (" + proveResult.elapsed_ms + "ms)");

      // Step 3: Build and submit on-chain settlement transaction
      setStep("submitting");
      appendLog("[Network] Building settle_atomic transaction...");

      const proofSize = proveResult.proof_bytes
        ? new Uint8Array(proveResult.proof_bytes).length
        : 256;
      appendLog("[Network] Proof size: " + proofSize + " bytes");

      // Construct the SettleAtomicParams from proof data
      const proofBytes = proveResult.proof_bytes
        ? new Uint8Array(proveResult.proof_bytes)
        : new Uint8Array(256);

      // Extract ciphertexts from crypto result
      const ctData = cryptoResult;

      // Build params for settle_atomic (using proof as both proof_a and proof_b
      // for single-party settlement; production would have separate proofs per party)
      const settleParams: SettleAtomicParams = {
        nonce: Date.now(), // Use timestamp as nonce for uniqueness
        proof_a: proofBytes,
        new_ct_a_lo: ctData.new_ct_lo ? new Uint8Array(ctData.new_ct_lo) : new Uint8Array(128),
        new_ct_a_hi: ctData.new_ct_hi ? new Uint8Array(ctData.new_ct_hi) : new Uint8Array(128),
        audit_ct_a_lo: new Uint8Array(128),
        audit_ct_a_hi: new Uint8Array(128),
        proof_b: proofBytes,
        new_ct_b_lo: ctData.new_ct_lo ? new Uint8Array(ctData.new_ct_lo) : new Uint8Array(128),
        new_ct_b_hi: ctData.new_ct_hi ? new Uint8Array(ctData.new_ct_hi) : new Uint8Array(128),
        audit_ct_b_lo: new Uint8Array(128),
        audit_ct_b_hi: new Uint8Array(128),
      };

      const estimatedCu = estimateSettleCu();
      appendLog("[Network] Estimated CU: " + estimatedCu.toLocaleString());

      // Send real on-chain transaction
      const txResult = await settleAtomic(
        connection,
        publicKey,
        counterparty,
        settleParams,
        signTransaction
      );

      appendLog("[Network] Transaction confirmed in slot " + txResult.slot);
      appendLog("[Nexum] Settlement complete — sig: " + txResult.signature);

      setResult({
        sig: txResult.signature,
        cu: txResult.computeUnits,
        slot: txResult.slot,
      });
      setStep("done");
    } catch (err: any) {
      appendLog("[ERROR] " + (err.message || "Unknown error"));
      setStep("idle");
    }
  }

  // Callback for LedgerView to decrypt balance via CryptoWorker
  const handleDecryptBalance = useCallback(
    (params: { ct_lo: Uint8Array; ct_hi: Uint8Array; sk: string }) => {
      return decryptBalance(params);
    },
    [decryptBalance]
  );

  return (
    <div className="min-h-screen bg-gray-950 text-green-400 p-8 font-mono">
      <h1 className="text-2xl mb-2">Nexum Protocol</h1>
      <p className="text-green-700 text-sm mb-6">OTTC Settlement — Zero-Knowledge Encrypted Balance Pool</p>

      <div className="mb-6 flex gap-4">
        <StatusBadge label="CryptoWorker" status={cryptoStatus} />
        <StatusBadge label="ProverWorker" status={proverStatus} />
      </div>

      {/* LedgerView with real decryption */}
      {publicKey && (
        <div className="mb-6 max-w-2xl">
          <LedgerView
            address={publicKey.toBase58()}
            version={1}
            status={bjjSk ? "Active" : "Inactive"}
            balanceCtLo={latestCtLo ?? undefined}
            balanceCtHi={latestCtHi ?? undefined}
            sk={bjjSk ?? undefined}
            onDecryptBalance={bjjSk ? handleDecryptBalance : undefined}
          />
        </div>
      )}

      {keyDeriving && (
        <div className="mb-4 border border-yellow-700 bg-yellow-950 p-3 max-w-2xl rounded text-yellow-400 text-sm">
          Deriving Baby Jubjub keypair from wallet signature... Please approve the signature request in your wallet.
        </div>
      )}

      <div className="border border-green-800 p-4 mb-6 max-w-2xl">
        <label className="block mb-2 text-sm">Counterparty Public Key:</label>
        <input
          type="text"
          value={counterpartyPk}
          onChange={e => setCounterpartyPk(e.target.value)}
          className="bg-gray-900 border border-green-700 p-2 w-full text-green-300 rounded mb-4 font-mono text-sm"
          placeholder="Enter counterparty Solana address (Base58)"
          disabled={!isReady || step !== "idle"}
        />

        <label className="block mb-2 text-sm">Transfer Amount (smallest units):</label>
        <input
          type="number"
          value={transferAmount}
          onChange={e => setTransferAmount(e.target.value)}
          className="bg-gray-900 border border-green-700 p-2 w-full text-green-300 rounded"
          placeholder="e.g. 1000000000 (= 1000 USDC)"
          disabled={!isReady || step !== "idle"}
        />
        <button
          onClick={handleSettle}
          disabled={!isReady || !transferAmount || !counterpartyPk.trim() || step !== "idle" || !publicKey}
          className="mt-4 px-6 py-2 bg-green-900 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed border border-green-600 rounded w-full"
        >
          {step === "idle"       && "Generate Proof & Settle"}
          {step === "proving"    && `Generating ZK Proof... ${Math.round(provingPct * 100)}%`}
          {step === "submitting" && "Submitting to Solana..."}
          {step === "done"       && "Settled!"}
        </button>
      </div>

      {result && (
        <div className="border border-yellow-700 bg-yellow-950 p-4 mb-6 max-w-2xl rounded">
          <p className="text-yellow-400 font-bold mb-2">Settlement Complete!</p>
          <p className="text-yellow-300 text-sm break-all">TX: {result.sig}</p>
          <p className="mt-2">
            Compute Units: <span className="text-2xl font-bold text-white">{result.cu?.toLocaleString()}</span>
            <span className="text-sm text-gray-400 ml-2">(2x Groth16 ZK proof verification)</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Slot: {result.slot?.toLocaleString()}</p>
        </div>
      )}

      <div className="max-w-2xl">
        <TerminalWindow logs={logs} />
      </div>
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status: WorkerStatus }) {
  const colors: Record<string, string> = {
    loading: "text-gray-500",
    warming: "text-yellow-400",
    ready:   "text-green-400",
    busy:    "text-blue-400",
    error:   "text-red-400",
  };
  return (
    <div className={`border border-current px-3 py-1 text-sm rounded ${colors[status]}`}>
      {label}: {status.toUpperCase()}
    </div>
  );
}
