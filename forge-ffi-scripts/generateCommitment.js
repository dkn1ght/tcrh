//forge-ffi-scripts/generateCommitment.js
const { ethers } = require("ethers");
const { pedersenHash } = require("./utils/pedersen.js");
const { rbigint, bigintToHex, leBigintToBuffer } = require("./utils/bigint.js");

// Intended output: (bytes32 commitment, bytes32 nullifier, bytes32 secret)

////////////////////////////// MAIN ///////////////////////////////////////////

async function main() {
  try {
    // 1. Generate random nullifier and secret
    console.error("Generating nullifier and secret..."); // 使用 stderr 避免污染输出
    const nullifier = rbigint(31);
    const secret = rbigint(31);

    console.error("Nullifier:", bigintToHex(nullifier));
    console.error("Secret:", bigintToHex(secret));

    // 2. Get commitment using Pedersen hash
    console.error("Computing commitment...");
    const commitment = await pedersenHash(
      Buffer.concat([
        leBigintToBuffer(nullifier, 31),
        leBigintToBuffer(secret, 31),
      ])
    );

    console.error("Commitment:", bigintToHex(commitment));

    // 3. Return abi encoded commitment, nullifier, secret (注意顺序!)
    // Ethers v5 使用 utils.defaultAbiCoder
    const res = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32"],
      [bigintToHex(commitment), bigintToHex(nullifier), bigintToHex(secret)]
    );

    console.error("Encoded result length:", res.length);
    return res;

  } catch (error) {
    console.error("Error in main():", error.message);
    console.error("Stack trace:", error.stack);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main()
    .then((res) => {
      // 只输出结果到 stdout，其他信息用 stderr
      process.stdout.write(res);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error.message);
      process.exit(1);
    });
} else {
  // 如果被其他模块导入
  module.exports = { main };
}