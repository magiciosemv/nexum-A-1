/// Thin wrappers around Solana alt_bn128 syscalls for Solana 2.x
/// The alt_bn128 module is not available in modular solana_program 2.x,
/// so we call the raw syscall directly.

use solana_define_syscall::definitions::sol_alt_bn128_group_op;

const ALT_BN128_ADD: u64 = 0;
const ALT_BN128_MUL: u64 = 2;
const ALT_BN128_PAIRING: u64 = 3;

const ADDITION_INPUT_LEN: usize = 128;
const ADDITION_OUTPUT_LEN: usize = 64;
const MULTIPLICATION_INPUT_LEN: usize = 96;
const MULTIPLICATION_OUTPUT_LEN: usize = 64;
const PAIRING_OUTPUT_LEN: usize = 32;

/// G1 point addition: returns P + Q
/// Input: P[64] || Q[64] = 128 bytes
/// Output: (P+Q)[64] bytes
pub fn alt_bn128_addition(input: &[u8; ADDITION_INPUT_LEN]) -> Result<[u8; ADDITION_OUTPUT_LEN], u64> {
    let mut output = [0u8; ADDITION_OUTPUT_LEN];
    let result = unsafe {
        sol_alt_bn128_group_op(
            ALT_BN128_ADD,
            input.as_ptr(),
            ADDITION_INPUT_LEN as u64,
            output.as_mut_ptr(),
        )
    };
    if result == 0 {
        Ok(output)
    } else {
        Err(result)
    }
}

/// G1 scalar multiplication: returns scalar * point
/// Input: scalar[32] || point[64] = 96 bytes
/// Output: (scalar*point)[64] bytes
pub fn alt_bn128_multiplication(input: &[u8; MULTIPLICATION_INPUT_LEN]) -> Result<[u8; MULTIPLICATION_OUTPUT_LEN], u64> {
    let mut output = [0u8; MULTIPLICATION_OUTPUT_LEN];
    let result = unsafe {
        sol_alt_bn128_group_op(
            ALT_BN128_MUL,
            input.as_ptr(),
            MULTIPLICATION_INPUT_LEN as u64,
            output.as_mut_ptr(),
        )
    };
    if result == 0 {
        Ok(output)
    } else {
        Err(result)
    }
}

/// Pairing check: verifies e(a1, a2) * e(b1, b2) * ... = 1
/// Each element is 192 bytes: G1_point[64] || G2_point[128]
/// Output: 32 bytes (should be [0...01] for success)
pub fn alt_bn128_pairing(elements: &[u8]) -> Result<[u8; PAIRING_OUTPUT_LEN], u64> {
    let mut output = [0u8; PAIRING_OUTPUT_LEN];
    let result = unsafe {
        sol_alt_bn128_group_op(
            ALT_BN128_PAIRING,
            elements.as_ptr(),
            elements.len() as u64,
            output.as_mut_ptr(),
        )
    };
    if result == 0 {
        Ok(output)
    } else {
        Err(result)
    }
}
