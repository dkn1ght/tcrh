const { network, ethers } = require("hardhat");
const { load } = require("../lib/state");
const { execSync } = require("child_process");
const { createFileMerkleTreeClient } = require("../forge-ffi-scripts/merkleTreeFile.js");

// 為 ERC20 mixer 單獨使用一個本地 Merkle 樹文件，避免與 native mixer 混用
const ERC20_TREE_FILE = process.env.MERKLE_TREE_FILE_ERC20 || "merkle-tree-data-erc20.json";

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  console.log("=== Starting ERC20 Deposit Process ===");
  console.log("Network:", network.name);

  const [user] = await ethers.getSigners();

  // 檢查原生幣餘額（支付 gas）
  const nativeBalance = await user.getBalance();
  console.log("User native balance:", ethers.utils.formatEther(nativeBalance), "Native");

  if (nativeBalance.lt(ethers.utils.parseEther("0.00005"))) {
    throw new Error("原生幣餘額過低，無法支付 gas");
  }

  // 根據網絡名稱或配置加載地址
  let networkName = network.name;
  if (networkName === "unknown" && network.name === "localhost") {
    networkName = "localhost";
  }

  console.log("Loading addresses for network:", networkName);
  const addresses = load(networkName);

  if (!addresses || !addresses.mixerERC20) {
    throw new Error(`state.json 缺少 mixerERC20 位址，網絡: ${networkName}，先跑 01-deploy-tcrh-erc20.js`);
  }

  console.log("Using ERC20 mixer at:", addresses.mixerERC20);
  const mixer = await ethers.getContractAt("ERC20Tornado", addresses.mixerERC20);

  const tokenAddress = await mixer.token();
  const token = new ethers.Contract(tokenAddress, erc20Abi, user);

  // 讀取代幣信息
  let decimals = 18;
  let symbol = "ERC20";
  try {
    decimals = await token.decimals();
    symbol = await token.symbol();
  } catch (e) {
    console.warn("⚠️ 無法讀取 decimals/symbol，使用預設值");
  }

  const denomination = await mixer.denomination();
  console.log("Mixer denomination:", ethers.utils.formatUnits(denomination, decimals), symbol);
  console.log("Token:", tokenAddress);

  // 檢查代幣餘額與授權
  const tokenBalance = await token.balanceOf(user.address);
  console.log("User token balance:", ethers.utils.formatUnits(tokenBalance, decimals), symbol);

  if (tokenBalance.lt(denomination)) {
    throw new Error(`代幣餘額不足，需要至少 ${ethers.utils.formatUnits(denomination, decimals)} ${symbol}`);
  }

  const allowance = await token.allowance(user.address, mixer.address);
  if (allowance.lt(denomination)) {
    console.log("Approving mixer to spend tokens...");
    const approveTx = await token.approve(mixer.address, denomination);
    console.log("Approve tx sent:", approveTx.hash);
    await approveTx.wait();
    console.log("✅ Approve confirmed");
  } else {
    console.log("Existing allowance 足夠，跳過 approve");
  }

  try {
    // 1) 產生 commitment/nullifier/secret
    console.log("\n=== Generating Commitment ===");
    console.log("Running: node forge-ffi-scripts/generateCommitment.js");

    const raw = execSync("node forge-ffi-scripts/generateCommitment.js", {
      encoding: "utf8",
      timeout: 30000,
    })
      .toString()
      .trim();

    if (!raw) {
      throw new Error("generateCommitment.js 沒有輸出");
    }

    console.log("Raw output:", raw);

    const [commitment, nullifier, secret] = ethers.utils.defaultAbiCoder.decode(
      ["bytes32", "bytes32", "bytes32"],
      raw
    );

    console.log("Commitment:", commitment);
    console.log("Nullifier:", nullifier);
    console.log("Secret:", secret);

    // 2) 進行鏈上 deposit
    console.log("\n=== Making ERC20 Deposit ===");

    const gasEstimate = await mixer.connect(user).estimateGas.deposit(commitment);
    console.log("Estimated gas:", gasEstimate.toString());

    const tx = await mixer.connect(user).deposit(commitment, {
      gasLimit: gasEstimate.mul(120).div(100),
    });

    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Deposit confirmed!");
    console.log("Block number:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // 3) 本地文件 Merkle 樹記錄葉子
    try {
      console.log("\n=== Updating local Merkle tree file ===");
      const tree = await createFileMerkleTreeClient({ filePath: ERC20_TREE_FILE });
      const addResult = await tree.addLeaf(commitment);
      console.log("Local leaf index:", addResult.leaf.index);
      console.log("New local root:", addResult.root);
    } catch (fileTreeErr) {
      console.warn("⚠️ Failed to update local Merkle tree file:", fileTreeErr.message);
    }

    // 4) 顯示 note 信息
    const noteInfo = {
      nullifier,
      secret,
      commitment,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      depositAmount: ethers.utils.formatUnits(denomination, decimals),
      tokenSymbol: symbol,
      tokenAddress,
      network: networkName,
    };

    console.log("\n=== Deposit Note Info ===");
    console.log("Note details:", JSON.stringify(noteInfo, null, 2));
    console.log("\n=== ERC20 Deposit Completed Successfully ===");

    return noteInfo;
  } catch (error) {
    if (error.message.includes("generateCommitment.js")) {
      console.error("❌ 生成 commitment 失敗:");
      console.error("請檢查 forge-ffi-scripts/generateCommitment.js 是否存在且可執行");
    } else if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
      console.error("❌ Gas 估算失敗，可能是合約調用失敗");
      console.error("檢查 mixerERC20 合約是否正確部署，授權與餘額是否充足");
    }
    throw error;
  }
}

main()
  .then((result) => {
    console.log("\n=== Deposit Summary ===");
    console.log("- Commitment:", result.commitment);
    console.log("- Transaction:", result.txHash);
    console.log("- Block:", result.blockNumber);
    console.log("- Amount:", `${result.depositAmount} ${result.tokenSymbol}`);
    console.log("✅ ERC20 存款流程已完成！");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n=== Deposit Failed ===");
    console.error(error.message);
    console.error(error);
    process.exit(1);
  });
