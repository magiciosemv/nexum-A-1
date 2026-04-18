declare module "snarkjs" {
  export function groth16FullProve(
    input: Record<string, string | string[]>,
    wasmFile: string,
    zkeyFile: string
  ): Promise<any>;

  export function groth16Verify(
    vkey: any,
    publicSignals: string[],
    proof: any
  ): Promise<boolean>;
}
