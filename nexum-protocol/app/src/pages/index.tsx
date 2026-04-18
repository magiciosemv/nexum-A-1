import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";

export default function Home() {
  const { publicKey } = useWallet();

  return (
    <div className="min-h-screen bg-gray-950 text-green-400 p-8 font-mono">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl mb-2">Nexum Protocol</h1>
        <p className="text-green-700 mb-8">Solana Encrypted Balance Pool for Institutional OTC Settlement</p>

        <div className="mb-8">
          <WalletMultiButton />
        </div>

        {publicKey && (
          <div className="border border-green-800 p-4 rounded mb-6">
            <p className="text-sm text-green-600 mb-2">Connected: {publicKey.toBase58().slice(0, 12)}...</p>
            <div className="flex gap-4">
              <Link href="/settle" className="px-4 py-2 bg-green-900 border border-green-600 rounded hover:bg-green-800">
                Settle OTC
              </Link>
              <Link href="/audit" className="px-4 py-2 bg-gray-900 border border-green-700 rounded hover:bg-gray-800">
                Audit
              </Link>
            </div>
          </div>
        )}

        <div className="border border-green-900 p-4 rounded text-xs text-green-700 mt-8">
          <h3 className="text-green-500 mb-2">Protocol Overview</h3>
          <ul className="space-y-1">
            <li>- Baby Jubjub ElGamal encrypted balance pool</li>
            <li>- Groth16 ZK proof: 3s browser generation, 198K CU on-chain verification</li>
            <li>- Zero plaintext amounts during settlement</li>
            <li>- Regulatory audit with on-chain proof trail</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
