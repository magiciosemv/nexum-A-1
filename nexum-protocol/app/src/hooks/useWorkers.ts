import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────

export type WorkerStatus = "loading" | "warming" | "ready" | "busy" | "error";

export interface EncryptParams {
  amount: number;
  recipient: string;
}

export interface EncryptResult {
  input: Record<string, string>;
  new_ct_lo: number[];
  new_ct_hi: number[];
}

export interface ProofParams {
  input: Record<string, string>;
}

export interface ProofResult {
  proof_bytes: number[];
  public_signals: string[];
  elapsed_ms: number;
}

export interface DecryptBalanceParams {
  ct_lo: Uint8Array;
  ct_hi: Uint8Array;
  sk: string;
}

export interface UseWorkersReturn {
  isReady: boolean;
  cryptoStatus: WorkerStatus;
  proverStatus: WorkerStatus;
  status: string;
  provingPct: number;
  encrypt: (params: EncryptParams) => Promise<EncryptResult>;
  generateProof: (params: ProofParams) => Promise<ProofResult>;
  decryptBalance: (params: DecryptBalanceParams) => Promise<string>;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useWorkers(onLog: (msg: string) => void): UseWorkersReturn {
  const [cryptoStatus, setCryptoStatus] = useState<WorkerStatus>("loading");
  const [proverStatus, setProverStatus] = useState<WorkerStatus>("loading");
  const [provingPct, setProvingPct] = useState(0);

  const cryptoWorkerRef = useRef<Worker | null>(null);
  const proverWorkerRef = useRef<Worker | null>(null);

  const isReady = cryptoStatus === "ready" && proverStatus === "ready";

  const status = isReady
    ? "ready"
    : cryptoStatus === "error" || proverStatus === "error"
      ? "error"
      : "warming";

  // ── Worker lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cryptoWorker = new Worker(
      new URL("../../../sdk/src/workers/CryptoWorker.ts", import.meta.url),
      { type: "module" }
    );
    cryptoWorkerRef.current = cryptoWorker;

    cryptoWorker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case "WARMUP_PROGRESS":
          if (Math.round(msg.pct * 100) % 20 === 0) {
            onLog(`[CryptoWorker] BSGS table: ${Math.round(msg.pct * 100)}%`);
          }
          break;
        case "WARMUP_COMPLETE":
          setCryptoStatus("ready");
          onLog(`[CryptoWorker] BSGS ready (${msg.elapsed_ms}ms)`);
          break;
        default:
          break;
      }
    };
    cryptoWorker.onerror = () => setCryptoStatus("error");
    onLog("[CryptoWorker] Starting BSGS warmup...");
    cryptoWorker.postMessage({ type: "WARMUP" });
    setCryptoStatus("warming");

    const proverWorker = new Worker(
      new URL("../../../sdk/src/workers/ProverWorker.ts", import.meta.url),
      { type: "module" }
    );
    proverWorkerRef.current = proverWorker;

    proverWorker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case "WASM_READY":
          setProverStatus("ready");
          onLog("[ProverWorker] WASM loaded");
          break;
        case "PROVE_PROGRESS":
          setProvingPct(msg.pct);
          onLog(`[ProverWorker] Proving: ${Math.round(msg.pct * 100)}%`);
          break;
        case "PROVE_DONE":
          setProverStatus("ready");
          setProvingPct(0);
          onLog(`[ProverWorker] Proof done (${msg.elapsed_ms}ms, 256 bytes)`);
          break;
      }
    };
    proverWorker.onerror = () => setProverStatus("error");

    onLog("[ProverWorker] Loading WASM...");
    proverWorker.postMessage({
      type: "PRELOAD_WASM",
      wasm_path: "/balance_transition.wasm",
      zkey_path: "/circuit_0001.zkey",
    });
    setProverStatus("warming");

    return () => {
      cryptoWorker.terminate();
      proverWorker.terminate();
    };
  }, [onLog]);

  // ── Imperative actions ────────────────────────────────────────────

  const encrypt = useCallback(
    (params: EncryptParams): Promise<EncryptResult> => {
      const worker = cryptoWorkerRef.current;
      if (!worker) throw new Error("CryptoWorker not initialized");

      return new Promise((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === "ENCRYPT_DONE") {
            worker.removeEventListener("message", handler);
            resolve({
              input: e.data.input,
              new_ct_lo: e.data.new_ct_lo,
              new_ct_hi: e.data.new_ct_hi,
            });
          }
          if (e.data.type === "ERROR") {
            worker.removeEventListener("message", handler);
            reject(new Error(e.data.message ?? e.data.error ?? "Encrypt failed"));
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({
          type: "ENCRYPT",
          amount: params.amount,
          recipient: params.recipient,
        });
      });
    },
    []
  );

  const generateProof = useCallback(
    (params: ProofParams): Promise<ProofResult> => {
      const worker = proverWorkerRef.current;
      if (!worker) throw new Error("ProverWorker not initialized");

      return new Promise((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === "PROVE_DONE") {
            worker.removeEventListener("message", handler);
            resolve({
              proof_bytes: e.data.proof_bytes,
              public_signals: e.data.public_signals,
              elapsed_ms: e.data.elapsed_ms,
            });
          }
          if (e.data.type === "PROVE_ERROR") {
            worker.removeEventListener("message", handler);
            reject(new Error(e.data.message ?? e.data.error ?? "Proof failed"));
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({
          type: "PROVE",
          input: params.input,
        });
      });
    },
    []
  );

  const decryptBalance = useCallback(
    (params: DecryptBalanceParams): Promise<string> => {
      const worker = cryptoWorkerRef.current;
      if (!worker) throw new Error("CryptoWorker not initialized");

      return new Promise((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === "DECRYPT_BALANCE_RESULT") {
            worker.removeEventListener("message", handler);
            resolve(e.data.balance);
          }
          if (e.data.type === "ERROR") {
            worker.removeEventListener("message", handler);
            reject(new Error(e.data.message ?? e.data.error ?? "Decrypt failed"));
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({
          type: "DECRYPT_BALANCE",
          ct_lo: Array.from(params.ct_lo),
          ct_hi: Array.from(params.ct_hi),
          sk: params.sk,
        });
      });
    },
    []
  );

  return {
    isReady,
    cryptoStatus,
    proverStatus,
    status,
    provingPct,
    encrypt,
    generateProof,
    decryptBalance,
  };
}
