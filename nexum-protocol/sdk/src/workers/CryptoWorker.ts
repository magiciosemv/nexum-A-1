import { buildBSGSTable, bsgsDecrypt } from "../crypto/bsgs";
import type { BSGSTable } from "../crypto/bsgs";
import { encrypt, serializeCiphertext, deserializeCiphertext } from "../crypto/elgamal";
import { splitU64 } from "../crypto/utils";

let bsgsTable: BSGSTable | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case "WARMUP": {
      const start = Date.now();
      bsgsTable = buildBSGSTable((pct) => {
        self.postMessage({ type: "WARMUP_PROGRESS", pct });
      });
      self.postMessage({ type: "WARMUP_COMPLETE", elapsed_ms: Date.now() - start });
      break;
    }

    case "DECRYPT_BALANCE": {
      if (!bsgsTable) {
        self.postMessage({ type: "ERROR", id: msg.id, error: "Table not ready" });
        return;
      }
      const lo = bsgsDecrypt(deserializeCiphertext(new Uint8Array(msg.ct_lo)), msg.sk, bsgsTable);
      const hi = bsgsDecrypt(deserializeCiphertext(new Uint8Array(msg.ct_hi)), msg.sk, bsgsTable);
      const balance = hi * (1n << 32n) + lo;
      self.postMessage({ type: "DECRYPT_BALANCE_RESULT", id: msg.id, balance: balance.toString() });
      break;
    }

    case "ENCRYPT": {
      // Encrypt a transfer amount for the settlement flow
      if (!bsgsTable) {
        self.postMessage({ type: "ERROR", error: "BSGS table not ready" });
        return;
      }
      const { amount } = msg;
      const amountBig = BigInt(amount);
      const { lo, hi } = splitU64(amountBig);

      // For demo: generate a random keypair for encryption
      // In production: use deriveKeyPair() with wallet signature
      const { secureRandom } = await import("../crypto/elgamal");
      const { derivePublicKey } = await import("../crypto/keys");
      const sk = secureRandom();
      const pk = derivePublicKey(sk);

      const { ct: ctLo, r: rLo } = encrypt(lo, pk);
      const { ct: ctHi, r: rHi } = encrypt(hi, pk);

      const input = {
        old_balance_lo: lo.toString(),
        old_balance_hi: hi.toString(),
        new_balance_lo: lo.toString(), // simplified
        new_balance_hi: hi.toString(),
        amount_lo: lo.toString(),
        amount_hi: hi.toString(),
        pk_x: pk.x.toString(),
        pk_y: pk.y.toString(),
        r_lo: rLo.toString(),
        r_hi: rHi.toString(),
      };

      self.postMessage({
        type: "ENCRYPT_DONE",
        input,
        ct_lo: Array.from(serializeCiphertext(ctLo)),
        ct_hi: Array.from(serializeCiphertext(ctHi)),
      });
      break;
    }

    case "COMPUTE_NEW_CIPHERTEXT": {
      if (!bsgsTable) {
        self.postMessage({ type: "ERROR", id: msg.id, error: "Table not ready" });
        return;
      }

      const { old_balance, transfer, is_sender } = msg;
      const new_balance = is_sender ? old_balance - transfer : old_balance + transfer;

      if (is_sender && new_balance < 0n) {
        self.postMessage({ type: "ERROR", id: msg.id, error: "Insufficient balance" });
        return;
      }

      const old_split = splitU64(old_balance);
      const tra_split = splitU64(transfer);
      const new_split = splitU64(new_balance);

      const userPk = { x: msg.user_pk_x, y: msg.user_pk_y };
      const auditPk = { x: msg.audit_pk_x, y: msg.audit_pk_y };

      const { ct: new_ct_lo, r: r_new_lo } = encrypt(new_split.lo, userPk);
      const { ct: new_ct_hi, r: r_new_hi } = encrypt(new_split.hi, userPk);
      const { ct: audit_ct_lo, r: r_aud_lo } = encrypt(tra_split.lo, auditPk);
      const { ct: audit_ct_hi, r: r_aud_hi } = encrypt(tra_split.hi, auditPk);

      self.postMessage({
        type: "COMPUTE_NEW_CIPHERTEXT_RESULT",
        id: msg.id,
        old_split: { lo: old_split.lo.toString(), hi: old_split.hi.toString() },
        tra_split: { lo: tra_split.lo.toString(), hi: tra_split.hi.toString() },
        new_split: { lo: new_split.lo.toString(), hi: new_split.hi.toString() },
        new_ct_lo: Array.from(serializeCiphertext(new_ct_lo)),
        new_ct_hi: Array.from(serializeCiphertext(new_ct_hi)),
        audit_ct_lo: Array.from(serializeCiphertext(audit_ct_lo)),
        audit_ct_hi: Array.from(serializeCiphertext(audit_ct_hi)),
        r_new_lo: r_new_lo.toString(),
        r_new_hi: r_new_hi.toString(),
        r_aud_lo: r_aud_lo.toString(),
        r_aud_hi: r_aud_hi.toString(),
      });
      break;
    }
  }
};
