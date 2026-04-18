import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { NexumProtocol } from "../target/types/nexum_protocol";

describe("nexum-protocol", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.nexumProtocol as Program<NexumProtocol>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
