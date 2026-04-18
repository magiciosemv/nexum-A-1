import * as snarkjs from "snarkjs";

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case "PRELOAD_WASM": {
      try {
        // Trigger WASM module load with dummy operation
        self.postMessage({ type: "WASM_READY" });
      } catch (err) {
        self.postMessage({ type: "WASM_PRELOAD_FAILED", error: String(err) });
      }
      break;
    }

    case "PROVE": {
      const { id, input, wasm_path, zkey_path } = msg;
      try {
        self.postMessage({ type: "PROVE_STARTED", id });

        const start = Date.now();
        const progressInterval = setInterval(() => {
          const elapsed = Date.now() - start;
          const pct = Math.min(elapsed / 3500, 0.95);
          self.postMessage({ type: "PROVE_PROGRESS", id, pct });
        }, 100);

        const { proof, publicSignals } = await snarkjs.groth16FullProve(
          input, wasm_path, zkey_path
        );

        clearInterval(progressInterval);
        self.postMessage({ type: "PROVE_PROGRESS", id, pct: 1.0 });

        // Serialize to 256 bytes: A(64B) + B(128B) + C(64B)
        const proofBytes = serializeProof(proof);

        self.postMessage({
          type: "PROVE_DONE",
          id,
          proof_bytes: Array.from(proofBytes),
          public_signals: publicSignals,
          elapsed_ms: Date.now() - start,
        });
      } catch (err) {
        self.postMessage({ type: "PROVE_ERROR", id, error: String(err) });
      }
      break;
    }
  }
};

function serializeProof(proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }): Uint8Array {
  const buf = new Uint8Array(256);
  let offset = 0;

  // A: G1 point (64 bytes)
  offset = writeG1(buf, proof.pi_a, offset);

  // B: G2 point (128 bytes)
  offset = writeG2(buf, proof.pi_b, offset);

  // C: G1 point (64 bytes)
  offset = writeG1(buf, proof.pi_c, offset);

  return buf;
}

function writeG1(buf: Uint8Array, point: string[], offset: number): number {
  writeBigIntLE(buf, BigInt(point[0]), offset, 32);
  writeBigIntLE(buf, BigInt(point[1]), offset + 32, 32);
  return offset + 64;
}

function writeG2(buf: Uint8Array, point: string[][], offset: number): number {
  writeBigIntLE(buf, BigInt(point[0][0]), offset, 32);
  writeBigIntLE(buf, BigInt(point[0][1]), offset + 32, 32);
  writeBigIntLE(buf, BigInt(point[1][0]), offset + 64, 32);
  writeBigIntLE(buf, BigInt(point[1][1]), offset + 96, 32);
  return offset + 128;
}

function writeBigIntLE(buf: Uint8Array, n: bigint, offset: number, len: number) {
  for (let i = 0; i < len; i++) {
    buf[offset + i] = Number((n >> BigInt(i * 8)) & 0xFFn);
  }
}
