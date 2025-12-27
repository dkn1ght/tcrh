// scripts/deposit.js
const { network, ethers } = require("hardhat");
const { load } = require("../lib/state");
const { execSync } = require("child_process");
const { createFileMerkleTreeClient } = require("../forge-ffi-scripts/merkleTreeFile.js");

async function main() {
    console.log("=== Starting Deposit Process ===");
    console.log("Network:", network.name);

    const [deployer] = await ethers.getSigners();

    // 檢查賬戶餘額
    const balance = await deployer.getBalance();
    console.log("User balance:", ethers.utils.formatEther(balance), "Native");

    if (balance.lt(ethers.utils.parseEther("0.00011"))) {
        throw new Error("餘額不足！需要至少 1.1 Native (1 Native 存款 + gas 費用)");
    }

    const [user] = await ethers.getSigners();

    // 根據網絡名稱或配置加載地址
    let networkName = network.name;
    if (networkName === "unknown" && network.name === "localhost") {
        networkName = "localhost";
    }

    console.log("Loading addresses for network:", networkName);
    const addresses = load(networkName);

    if (!addresses || !addresses.mixer) {
        throw new Error(`state.json 缺少 mixer 位址，網絡: ${networkName}，先跑 deploy.js`);
    }

    console.log("Using mixer at:", addresses.mixer);
    const mixer = await ethers.getContractAt("ETHTornado", addresses.mixer);

    try {
        // 1) 產生 commitment/nullifier/secret
        console.log("\n=== Generating Commitment ===");
        console.log("Running: node forge-ffi-scripts/generateCommitment.js");

        const raw = execSync("node forge-ffi-scripts/generateCommitment.js", {
            encoding: 'utf8',
            timeout: 30000
        }).toString().trim();

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
        console.log("\n=== Making Deposit ===");

        const depositValue = ethers.utils.parseEther("0.0001");
        console.log("Deposit amount:", ethers.utils.formatEther(depositValue), "Native");

        // 估算 gas
        const gasEstimate = await mixer.connect(user).estimateGas.deposit(commitment, {
            value: depositValue
        });
        console.log("Estimated gas:", gasEstimate.toString());

        const tx = await mixer.connect(user).deposit(commitment, {
            value: depositValue,
            gasLimit: gasEstimate.mul(120).div(100)
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
            const tree = await createFileMerkleTreeClient();
            const addResult = await tree.addLeaf(commitment);
            console.log("Local leaf index:", addResult.leaf.index);
            console.log("New local root:", addResult.root);
        } catch (fileTreeErr) {
            console.warn("⚠️ Failed to update local Merkle tree file:", fileTreeErr.message);
        }

        // 4) 顯示 note 信息
        const noteInfo = {
            nullifier: nullifier,
            secret: secret,
            commitment: commitment,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            depositAmount: ethers.utils.formatEther(depositValue),
            network: networkName
        };

        console.log("\n=== Deposit Note Info ===");
        console.log("Note details:", JSON.stringify(noteInfo, null, 2));
        console.log("\n=== Deposit Completed Successfully ===");

        return noteInfo;

    } catch (error) {
        if (error.message.includes("generateCommitment.js")) {
            console.error("❌ 生成 commitment 失敗:");
            console.error("請檢查 forge-ffi-scripts/generateCommitment.js 是否存在且可執行");
        } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            console.error("❌ Gas 估算失敗，可能是合約調用失敗");
            console.error("檢查 mixer 合約是否正確部署，參數是否有效");
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
        console.log("✅ 存款流程已完成！");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n=== Deposit Failed ===");
        console.error(error.message);
        console.error(error);
        process.exit(1);
    });
