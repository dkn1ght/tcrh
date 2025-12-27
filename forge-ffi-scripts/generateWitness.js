//forge-ffi-scripts/generateWitness.js
const path = require("path");
const snarkjs = require("snarkjs");
const { ethers } = require("ethers");

const {
  hexToBigint,
  bigintToHex,
  leBigintToBuffer,
} = require("./utils/bigint.js");

const { pedersenHash } = require("./utils/pedersen.js");
const { mimicMerkleTree } = require("./utils/mimcMerkleTree.js");

// Intended output: (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC, bytes32 root, bytes32 nullifierHash)

////////////////////////////// MAIN ///////////////////////////////////////////

async function main() {
  try {
    const inputs = process.argv.slice(2, process.argv.length);
    
    console.error("=== GenerateWitness Debug Info ===");
    console.error("Total arguments:", inputs.length);
    console.error("Arguments:", inputs.slice(0, 6)); // 不打印所有叶子节点，太多了

    if (inputs.length < 7) { // 至少需要 nullifier, secret, recipient, relayer, fee, refund, 和至少一个叶子节点
      throw new Error(`Not enough arguments. Expected at least 7, got ${inputs.length}`);
    }

    // 1. Get nullifier and secret
    const nullifier = hexToBigint(inputs[0]);
    const secret = hexToBigint(inputs[1]);

    console.error("Parsed nullifier:", nullifier.toString());
    console.error("Parsed secret:", secret.toString());

    // 2. Get nullifier hash
    console.error("Computing nullifier hash...");
    const nullifierHash = await pedersenHash(leBigintToBuffer(nullifier, 31));
    console.error("Nullifier hash:", bigintToHex(nullifierHash));

    // 3. Create merkle tree, insert leaves and get merkle proof for commitment
    console.error("Processing", inputs.length - 6, "leaves...");
    const leaves = inputs.slice(6, inputs.length).map((l) => {
      console.error("Processing leaf:", l);
      return hexToBigint(l);
    });


    console.error("Computing commitment...");
    const commitment = await pedersenHash(
      Buffer.concat([
        leBigintToBuffer(nullifier, 31),
        leBigintToBuffer(secret, 31),
      ])
    );
    console.error("Commitment:", bigintToHex(commitment));
    

    console.error("Creating merkle tree...");
    const tree = await mimicMerkleTree(leaves);

    console.error("Getting merkle proof...");
    const merkleProof = tree.proof(commitment);

    console.error("Merkle root:", bigintToHex(merkleProof.pathRoot));

    // 4. Format witness input to exactly match circuit expectations
    const input = {
      // Public inputs
      root: merkleProof.pathRoot,
      nullifierHash: nullifierHash,
      recipient: hexToBigint(inputs[2]),
      relayer: hexToBigint(inputs[3]),
      fee: BigInt(inputs[4]),
      refund: BigInt(inputs[5]),

      // Private inputs
      nullifier: nullifier,
      secret: secret,
      pathElements: merkleProof.pathElements.map((x) => x.toString()),
      pathIndices: merkleProof.pathIndices,
    };

    console.error("Circuit input prepared");

    // 5. Create groth16 proof for witness
    console.error("Generating groth16 proof...");
    const { proof } = await snarkjs.groth16.fullProve(
      input,
      path.join(__dirname, "../circuit_artifacts/withdraw_js/withdraw.wasm"),
      path.join(__dirname, "../circuit_artifacts/withdraw_final.zkey")
    );

    console.error("Groth16 proof generated");

    const pA = proof.pi_a.slice(0, 2);
    const pB = proof.pi_b.slice(0, 2);
    const pC = proof.pi_c.slice(0, 2);

    console.error("Proof components extracted");

    // 6. Return abi encoded witness (修正：使用 Ethers v5 语法)
    const witness = ethers.utils.defaultAbiCoder.encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]", "bytes32", "bytes32"],
      [
        pA,
        // Swap x coordinates: this is for proof verification with the Solidity precompile for EC Pairings, and not required
        // for verification with e.g. snarkJS.
        [
          [pB[0][1], pB[0][0]],
          [pB[1][1], pB[1][0]],
        ],
        pC,
        bigintToHex(merkleProof.pathRoot),
        bigintToHex(nullifierHash),
      ]
    );

    console.error("ABI encoding completed");
    console.error("Final witness length:", witness.length);

    return witness;

  } catch (error) {
    console.error("❌ Error in generateWitness:");
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    throw error;
  }
}

main()
  .then((wtns) => {
    // 只输出结果到 stdout
    process.stdout.write(wtns);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ GenerateWitness failed:", error.message);
    process.exit(1);
  });