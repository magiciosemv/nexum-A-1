pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/escalarmulany.circom";

template ElGamalVerify() {
    signal input m;
    signal input r;
    signal input pkX;
    signal input pkY;
    signal input C1x;
    signal input C1y;
    signal input C2x;
    signal input C2y;

    // C1 = r * G (verify ephemeral key — fixed-base)
    component rG = BabyPbk();
    rG.in <== r;
    rG.Ax === C1x;
    rG.Ay === C1y;

    // m * G (fixed-base)
    component mG = BabyPbk();
    mG.in <== m;

    // r * pk (variable-base scalar multiplication)
    component rBits = Num2Bits(253);
    rBits.in <== r;

    component rPk = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        rPk.e[i] <== rBits.out[i];
    }
    rPk.p[0] <== pkX;
    rPk.p[1] <== pkY;

    // C2 = m*G + r*pk (verify ciphertext)
    component add = BabyAdd();
    add.x1 <== mG.Ax;
    add.y1 <== mG.Ay;
    add.x2 <== rPk.out[0];
    add.y2 <== rPk.out[1];
    add.xout === C2x;
    add.yout === C2y;
}

template BalanceTransition() {
    // Private inputs: balance values and random nonces (12 total)
    signal input old_balance_lo;
    signal input old_balance_hi;
    signal input transfer_lo;
    signal input transfer_hi;
    signal input new_balance_lo;
    signal input new_balance_hi;
    signal input r_old_lo;
    signal input r_old_hi;
    signal input r_new_lo;
    signal input r_new_hi;
    signal input r_audit_lo;
    signal input r_audit_hi;

    // Public inputs: keys and ciphertexts (30 total)
    signal input user_pkX;
    signal input user_pkY;
    signal input audit_pkX;
    signal input audit_pkY;
    signal input old_ct_lo_C1x;
    signal input old_ct_lo_C1y;
    signal input old_ct_lo_C2x;
    signal input old_ct_lo_C2y;
    signal input old_ct_hi_C1x;
    signal input old_ct_hi_C1y;
    signal input old_ct_hi_C2x;
    signal input old_ct_hi_C2y;
    signal input new_ct_lo_C1x;
    signal input new_ct_lo_C1y;
    signal input new_ct_lo_C2x;
    signal input new_ct_lo_C2y;
    signal input new_ct_hi_C1x;
    signal input new_ct_hi_C1y;
    signal input new_ct_hi_C2x;
    signal input new_ct_hi_C2y;
    signal input audit_ct_lo_C1x;
    signal input audit_ct_lo_C1y;
    signal input audit_ct_lo_C2x;
    signal input audit_ct_lo_C2y;
    signal input audit_ct_hi_C1x;
    signal input audit_ct_hi_C1y;
    signal input audit_ct_hi_C2x;
    signal input audit_ct_hi_C2y;
    signal input expected_version;
    signal input is_sender;

    // Constraint 1-2: Old balance ciphertexts are valid
    component vOldLo = ElGamalVerify();
    vOldLo.m   <== old_balance_lo;
    vOldLo.r   <== r_old_lo;
    vOldLo.pkX <== user_pkX;
    vOldLo.pkY <== user_pkY;
    vOldLo.C1x <== old_ct_lo_C1x;
    vOldLo.C1y <== old_ct_lo_C1y;
    vOldLo.C2x <== old_ct_lo_C2x;
    vOldLo.C2y <== old_ct_lo_C2y;

    component vOldHi = ElGamalVerify();
    vOldHi.m   <== old_balance_hi;
    vOldHi.r   <== r_old_hi;
    vOldHi.pkX <== user_pkX;
    vOldHi.pkY <== user_pkY;
    vOldHi.C1x <== old_ct_hi_C1x;
    vOldHi.C1y <== old_ct_hi_C1y;
    vOldHi.C2x <== old_ct_hi_C2x;
    vOldHi.C2y <== old_ct_hi_C2y;

    // Constraint 3-4: New balance ciphertexts are valid
    component vNewLo = ElGamalVerify();
    vNewLo.m   <== new_balance_lo;
    vNewLo.r   <== r_new_lo;
    vNewLo.pkX <== user_pkX;
    vNewLo.pkY <== user_pkY;
    vNewLo.C1x <== new_ct_lo_C1x;
    vNewLo.C1y <== new_ct_lo_C1y;
    vNewLo.C2x <== new_ct_lo_C2x;
    vNewLo.C2y <== new_ct_lo_C2y;

    component vNewHi = ElGamalVerify();
    vNewHi.m   <== new_balance_hi;
    vNewHi.r   <== r_new_hi;
    vNewHi.pkX <== user_pkX;
    vNewHi.pkY <== user_pkY;
    vNewHi.C1x <== new_ct_hi_C1x;
    vNewHi.C1y <== new_ct_hi_C1y;
    vNewHi.C2x <== new_ct_hi_C2x;
    vNewHi.C2y <== new_ct_hi_C2y;

    // Constraint 5-6: Audit ciphertexts are valid (transfer amount encrypted to auditor)
    component vAudLo = ElGamalVerify();
    vAudLo.m   <== transfer_lo;
    vAudLo.r   <== r_audit_lo;
    vAudLo.pkX <== audit_pkX;
    vAudLo.pkY <== audit_pkY;
    vAudLo.C1x <== audit_ct_lo_C1x;
    vAudLo.C1y <== audit_ct_lo_C1y;
    vAudLo.C2x <== audit_ct_lo_C2x;
    vAudLo.C2y <== audit_ct_lo_C2y;

    component vAudHi = ElGamalVerify();
    vAudHi.m   <== transfer_hi;
    vAudHi.r   <== r_audit_hi;
    vAudHi.pkX <== audit_pkX;
    vAudHi.pkY <== audit_pkY;
    vAudHi.C1x <== audit_ct_hi_C1x;
    vAudHi.C1y <== audit_ct_hi_C1y;
    vAudHi.C2x <== audit_ct_hi_C2x;
    vAudHi.C2y <== audit_ct_hi_C2y;

    // Constraint 7: Balance conservation (64-bit via hi/lo merge)
    signal old64 <== old_balance_hi * (1 << 32) + old_balance_lo;
    signal tra64 <== transfer_hi    * (1 << 32) + transfer_lo;
    signal new64 <== new_balance_hi * (1 << 32) + new_balance_lo;

    signal diff_sender   <== old64 - tra64 - new64;
    signal diff_receiver <== old64 + tra64 - new64;
    signal delta <== diff_sender - diff_receiver;
    signal weighted <== is_sender * delta;
    0 === weighted + diff_receiver;

    // Constraints 8-11: Range proofs (amounts in [0, 2^32))
    component bTrLo = Num2Bits(32); bTrLo.in <== transfer_lo;
    component bTrHi = Num2Bits(32); bTrHi.in <== transfer_hi;
    component bNwLo = Num2Bits(32); bNwLo.in <== new_balance_lo;
    component bNwHi = Num2Bits(32); bNwHi.in <== new_balance_hi;
}

// Instantiate with 30 public inputs
component main {
    public [
        user_pkX, user_pkY, audit_pkX, audit_pkY,
        old_ct_lo_C1x, old_ct_lo_C1y, old_ct_lo_C2x, old_ct_lo_C2y,
        old_ct_hi_C1x, old_ct_hi_C1y, old_ct_hi_C2x, old_ct_hi_C2y,
        new_ct_lo_C1x, new_ct_lo_C1y, new_ct_lo_C2x, new_ct_lo_C2y,
        new_ct_hi_C1x, new_ct_hi_C1y, new_ct_hi_C2x, new_ct_hi_C2y,
        audit_ct_lo_C1x, audit_ct_lo_C1y, audit_ct_lo_C2x, audit_ct_lo_C2y,
        audit_ct_hi_C1x, audit_ct_hi_C1y, audit_ct_hi_C2x, audit_ct_hi_C2y,
        expected_version, is_sender
    ]
} = BalanceTransition();
