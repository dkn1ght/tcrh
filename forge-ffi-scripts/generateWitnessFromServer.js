// forge-ffi-scripts/generateWitnessFromServer.js
const path = require("path");
const snarkjs = require("snarkjs");
const { ethers } = require("ethers");
const { createFileMerkleTreeClient } = require("./merkleTreeFile.js");

const {
  hexToBigint,
  bigintToHex,
  leBigintToBuffer,
} = require("./utils/bigint.js");

const { pedersenHash } = require("./utils/pedersen.js");

// This script uses the server's pre-computed Merkle proof instead of rebuilding the tree
// Usage: node generateWitnessFromServer.js <nullifier> <secret> <recipient> <relayer> <fee> <refund> <commitment>

async function main() {
  try {
    const inputs = process.argv.slice(2);
    
    console.error("=== GenerateWitnessFromServer Debug Info ===");
    console.error("Total arguments:", inputs.length);
    console.error("Arguments:", inputs);

    if (inputs.length !== 7) {
      throw new Error(`Expected exactly 7 arguments: nullifier, secret, recipient, relayer, fee, refund, commitment. Got ${inputs.length}`);
    }

    // 1. Parse arguments
    const nullifier = hexToBigint(inputs[0]);
    const secret = hexToBigint(inputs[1]);
    const recipient = inputs[2];
    const relayer = inputs[3];
    const fee = BigInt(inputs[4]);
    const refund = BigInt(inputs[5]);
    const commitment = inputs[6];

    console.error("Parsed nullifier:", nullifier.toString());
    console.error("Parsed secret:", secret.toString());
    console.error("Commitment:", commitment);

    // 2. Compute nullifier hash
    console.error("Computing nullifier hash...");
    const nullifierHash = await pedersenHash(leBigintToBuffer(nullifier, 31));
    console.error("Nullifier hash:", bigintToHex(nullifierHash));

    // 3. Verify commitment matches nullifier + secret
    console.error("Verifying commitment...");
    const computedCommitment = await pedersenHash(
      Buffer.concat([
        leBigintToBuffer(nullifier, 31),
        leBigintToBuffer(secret, 31),
      ])
    );
    
    if (bigintToHex(computedCommitment).toLowerCase() !== commitment.toLowerCase()) {
      throw new Error("Commitment doesn't match nullifier + secret");
    }
    console.error("✅ Commitment verification passed");

    // 4. Get circuit-ready proof from local file Merkle tree
    console.error("Getting proof from local merkleTreeFile...");
    // 可透過環境變量指定本地樹文件，方便 ETH/ ERC20 分開
    const filePath =
      process.env.MERKLE_TREE_FILE ||
      process.env.MERKLE_TREE_FILE_ERC20 ||
      undefined;
    const tree = await createFileMerkleTreeClient(
      filePath ? { filePath } : {}
    );
    let serverProof;
    try {
      const proof = await tree.getProof(commitment);
      serverProof = {
        leaf: proof.leaf,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices,
        root: proof.root.startsWith("0x") ? proof.root.slice(2) : proof.root,
        pathRoot: proof.root.startsWith("0x")
          ? BigInt(proof.root)
          : BigInt("0x" + proof.root),
      };
      console.error("✅ Got proof from local file");
      console.error("- Leaf index:", serverProof.leaf.index);
      console.error("- Path elements count:", serverProof.pathElements.length);
      console.error("- Root:", serverProof.root.substring(0, 16) + "...");
    } catch (error) {
      throw new Error(`Local merkle tree proof error: ${error.message}`);
    }

    // 5. Format circuit input using server proof
    const input = {
      // Public inputs
      root: BigInt(serverProof.pathRoot),
      nullifierHash: nullifierHash,
      recipient: hexToBigint(recipient),
      relayer: hexToBigint(relayer),
      fee: fee,
      refund: refund,

      // Private inputs (from server proof)
      nullifier: nullifier,
      secret: secret,
      pathElements: serverProof.pathElements,  // Already in correct format from server
      pathIndices: serverProof.pathIndices,    // Already in correct format from server
    };

    console.error("Circuit input prepared using server proof");

    // 6. Generate groth16 proof
    console.error("Generating groth16 proof...");
    const { proof } = await snarkjs.groth16.fullProve(
      input,
      path.join(__dirname, "../circuit_artifacts/withdraw_js/withdraw.wasm"),
      path.join(__dirname, "../circuit_artifacts/withdraw_final.zkey")
    );

    console.error("✅ Groth16 proof generated successfully");

    const pA = proof.pi_a.slice(0, 2);
    const pB = proof.pi_b.slice(0, 2);
    const pC = proof.pi_c.slice(0, 2);

    console.error("Proof components extracted");

    // 7. Return abi encoded witness
    const witness = ethers.utils.defaultAbiCoder.encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]", "bytes32", "bytes32"],
      [
        pA,
        // Swap x coordinates for Solidity EC pairing precompile compatibility
        [
          [pB[0][1], pB[0][0]],
          [pB[1][1], pB[1][0]],
        ],
        pC,
        bigintToHex(BigInt(serverProof.pathRoot)),
        bigintToHex(nullifierHash),
      ]
    );

    console.error("✅ ABI encoding completed");
    console.error("Final witness length:", witness.length);

    return witness;

  } catch (error) {
    console.error("❌ Error in generateWitnessFromServer:");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    throw error;
  }
}

main()
  .then((witness) => {
    // Only output result to stdout
    process.stdout.write(witness);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ GenerateWitnessFromServer failed:", error.message);
    process.exit(1);
  });
