import { useEffect, useState } from "react";

interface LedgerViewProps {
  address: string;
  version: number;
  status: string;
  /** Serialized ciphertext bytes for balance_lo (128 bytes) */
  balanceCtLo?: Uint8Array | number[];
  /** Serialized ciphertext bytes for balance_hi (128 bytes) */
  balanceCtHi?: Uint8Array | number[];
  /** Baby Jubjub secret key as bigint string */
  sk?: string;
  /** Callback to decrypt balance via CryptoWorker */
  onDecryptBalance?: (params: {
    ct_lo: Uint8Array;
    ct_hi: Uint8Array;
    sk: string;
  }) => Promise<string>;
}

export function LedgerView({
  address,
  version,
  status,
  balanceCtLo,
  balanceCtHi,
  sk,
  onDecryptBalance,
}: LedgerViewProps) {
  const [balance, setBalance] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDecrypt =
    balanceCtLo &&
    balanceCtHi &&
    sk &&
    onDecryptBalance &&
    status === "Active";

  useEffect(() => {
    if (!canDecrypt) return;

    let cancelled = false;
    setDecrypting(true);
    setError(null);

    const ctLo =
      balanceCtLo instanceof Uint8Array
        ? balanceCtLo
        : new Uint8Array(balanceCtLo);
    const ctHi =
      balanceCtHi instanceof Uint8Array
        ? balanceCtHi
        : new Uint8Array(balanceCtHi);

    onDecryptBalance({ ct_lo: ctLo, ct_hi: ctHi, sk: sk! })
      .then((result) => {
        if (!cancelled) {
          setBalance(result);
          setDecrypting(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message ?? "Decryption failed");
          setDecrypting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [balanceCtLo, balanceCtHi, sk, onDecryptBalance, canDecrypt, status]);

  return (
    <div className="border border-green-800 bg-gray-950 p-3 rounded text-xs font-mono">
      <div className="text-green-600 mb-1">
        Ledger: {address.slice(0, 8)}...{address.slice(-4)}
      </div>
      <div className="flex gap-4 text-green-400">
        <span>Version: {version}</span>
        <span>
          Status:{" "}
          <span
            className={
              status === "Active" ? "text-green-500" : "text-yellow-500"
            }
          >
            {status}
          </span>
        </span>
      </div>

      {/* Balance display */}
      <div className="mt-2 pt-2 border-t border-green-900">
        {decrypting && (
          <span className="text-yellow-400">Decrypting balance...</span>
        )}
        {error && <span className="text-red-400">Error: {error}</span>}
        {balance !== null && !decrypting && !error && (
          <div className="text-green-300">
            Balance: <span className="text-white font-bold">{balance}</span>
            <span className="text-green-700 ml-1">(smallest units)</span>
          </div>
        )}
        {!canDecrypt && !balance && !decrypting && (
          <span className="text-green-700">
            No encrypted balance data available
          </span>
        )}
      </div>
    </div>
  );
}
