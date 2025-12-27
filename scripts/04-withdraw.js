// scripts/withdraw.js
const { network, ethers } = require("hardhat");
const { load } = require("../lib/state");
const { execSync } = require("child_process");
const { createFileMerkleTreeClient } = require("../forge-ffi-scripts/merkleTreeFile.js");

async function main() {
    console.log("=== Starting Withdraw Process ===");
    console.log("Network:", network.name);

    const [deployer] = await ethers.getSigners();

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

    // TODO: 替換為實際的 noteInfo
    const noteInfo = {
        nullifier: "0x00dbfb5ebbbd4fc0fd7e1fcb31c18edb6aaced998a9d1bfd7a4cc11580f877e5",  // 從存款獲得
        secret: "0x00fb7c040043300c8411865b830923b13e05c0ba11245635b3cb89909b999f0e",     // 從存款獲得
        commitment: "0x0a52859060920aac77301e42bf478f272e28e1d1a3f13f366d2b0d96aede3af1", // 從存款獲得
    };

    console.log("Using note info:");
    console.log("- Nullifier:", noteInfo.nullifier);
    console.log("- Secret:", noteInfo.secret);
    console.log("- Commitment:", noteInfo.commitment);

    // 設置提款參數
    const recipient = deployer.address;
    const relayer = ethers.constants.AddressZero;
    const fee = 0;
    const refund = 0;

    console.log("\n=== Withdraw Parameters ===");
    console.log("Recipient:", recipient);
    console.log("Relayer:", relayer);
    console.log("Fee:", fee);
    console.log("Refund:", refund);

    try {
        // 5) 從本地 merkleTreeFile 讀取電路就緒的證明
        console.log("\n=== Getting Circuit Proof from local merkleTreeFile ===");

        let circuitProof;
        try {
            const tree = await createFileMerkleTreeClient();
            const proof = await tree.getProof(noteInfo.commitment);
            circuitProof = proof;

            console.log("✅ 在本地文件中找到 commitment");
            console.log("葉子索引:", circuitProof.leaf.index);
            console.log("路徑元素數量:", circuitProof.pathElements.length);
            console.log("路徑索引數量:", circuitProof.pathIndices.length);
            console.log("根哈希:", circuitProof.root.substring(0, 16) + "...");

        } catch (error) {
            throw new Error(`本地 merkleTreeFile 中找不到 commitment 或讀取失敗: ${error.message}`);
        }

        // 6) 使用新的簡化 witness 生成器
        console.log("\n=== Generating Witness Using Local Proof ===");

        const args = [
            noteInfo.nullifier,
            noteInfo.secret,
            recipient,
            relayer,
            fee.toString(),
            refund.toString(),
            noteInfo.commitment
        ];

        console.log("使用服務器預計算的 Merkle 證明生成 witness");

        // 檢查新的 witness 生成器是否存在
        const fs = require('fs');
        const witnessScriptPath = 'forge-ffi-scripts/generateWitnessFromServer.js';
        if (!fs.existsSync(witnessScriptPath)) {
            throw new Error(`${witnessScriptPath} 不存在。請創建這個文件。`);
        }

        const command = `node ${witnessScriptPath} ${args.join(" ")}`;
        console.log("執行命令預覽:", command);

        let witnessResult;
        try {
            const result = execSync(command, {
                encoding: 'utf8',
                timeout: 120000,
                shell: true
            });

            witnessResult = result.toString().trim();

        } catch (execError) {
            console.error("❌ generateWitnessFromServer.js execution failed:");
            console.error("Exit code:", execError.status);

            if (execError.stderr) {
                console.error("Stderr output:");
                console.error(execError.stderr.toString());
            }

            if (execError.stdout) {
                console.error("Stdout output:");
                console.error(execError.stdout.toString());
            }

            throw new Error(`generateWitnessFromServer.js failed: ${execError.message}`);
        }

        console.log("✅ Witness generation completed");
        console.log("Output length:", witnessResult.length);

        if (!witnessResult || witnessResult.length === 0) {
            throw new Error("generateWitnessFromServer.js 沒有輸出任何內容");
        }

        // 檢查是否包含錯誤信息
        if (witnessResult.includes('Error:') || witnessResult.includes('error:')) {
            console.error("❌ generateWitnessFromServer.js 輸出包含錯誤信息:");
            console.error(witnessResult);
            throw new Error("generateWitnessFromServer.js 執行過程中出現錯誤");
        }

        // 7) 解碼 witness 結果
        let pA, pB, pC, root, nullifierHash;
        try {
            const decoded = ethers.utils.defaultAbiCoder.decode(
                ["uint256[2]", "uint256[2][2]", "uint256[2]", "bytes32", "bytes32"],
                witnessResult
            );

            [pA, pB, pC, root, nullifierHash] = decoded;

            console.log("✅ Successfully decoded witness result");
            console.log("- Root:", root);
            console.log("- Nullifier hash:", nullifierHash);

        } catch (decodeError) {
            console.error("❌ ABI 解碼失敗:");
            console.error("Error:", decodeError.message);
            console.error("Raw result length:", witnessResult.length);
            console.error("Raw result preview:", witnessResult.substring(0, 200));
            throw new Error(`ABI 解碼失敗: ${decodeError.message}`);
        }

        // 8) 驗證 root 一致性（與服務器比較）
        console.log("\n=== Verifying Root Consistency ===");
        const fileRootWithPrefix = circuitProof.root.startsWith('0x') ? circuitProof.root : '0x' + circuitProof.root;
        const rootsMatch = root.toLowerCase() === fileRootWithPrefix.toLowerCase();
        console.log(`Proof 中的根: ${root}`);
        console.log(`本地文件中的根: ${fileRootWithPrefix}`);
        console.log(`根哈希一致: ${rootsMatch ? '✅' : '❌'}`);

        if (!rootsMatch) {
            throw new Error("Proof 中的根與服務器根不一致");
        }

        // 9) 驗證 proof (如果有 verifier)
        console.log("\n=== Verifying Proof ===");
        if (addresses.verifier) {
            const verifier = await ethers.getContractAt("Groth16Verifier", addresses.verifier);

            const publicInputs = [
                ethers.BigNumber.from(root),
                ethers.BigNumber.from(nullifierHash),
                ethers.BigNumber.from(recipient),
                ethers.BigNumber.from(relayer),
                ethers.BigNumber.from(fee),
                ethers.BigNumber.from(refund)
            ];

            const isValidProof = await verifier.verifyProof(pA, pB, pC, publicInputs);
            console.log("Proof verification:", isValidProof ? "✅ Valid" : "❌ Invalid");

            if (!isValidProof) {
                throw new Error("Generated proof is invalid");
            }
        }

        // 10) 檢查餘額
        console.log("\n=== Checking Balances ===");
        const recipientBalanceBefore = await ethers.provider.getBalance(recipient);
        const mixerBalanceBefore = await ethers.provider.getBalance(mixer.address);

        console.log("Recipient balance before:", ethers.utils.formatEther(recipientBalanceBefore), "Native");
        console.log("Mixer balance before:", ethers.utils.formatEther(mixerBalanceBefore), "Native");

        // 11) 執行提款
        console.log("\n=== Executing Withdraw ===");

        const tx = await mixer.withdraw(
            pA,
            pB,
            pC,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            refund
        );

        console.log("Withdraw transaction sent:", tx.hash);
        console.log("Waiting for confirmation...");

        const receipt = await tx.wait();
        console.log("✅ Withdraw confirmed!");
        console.log("Block number:", receipt.blockNumber);
        console.log("Gas used:", receipt.gasUsed.toString());

        // 12) 檢查提款後餘額
        console.log("\n=== Checking Final Balances ===");
        const recipientBalanceAfter = await ethers.provider.getBalance(recipient);
        const mixerBalanceAfter = await ethers.provider.getBalance(mixer.address);

        console.log("Recipient balance after:", ethers.utils.formatEther(recipientBalanceAfter), "Native");
        console.log("Mixer balance after:", ethers.utils.formatEther(mixerBalanceAfter), "Native");

        const received = recipientBalanceAfter.sub(recipientBalanceBefore);
        console.log("Amount received:", ethers.utils.formatEther(received), "Native");

        console.log("\n=== Withdraw Completed Successfully ===");

        return {
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            recipient: recipient,
            amountReceived: ethers.utils.formatEther(received),
            gasUsed: receipt.gasUsed.toString()
        };

    } catch (error) {
        if (error.message.includes("generateWitnessFromServer.js")) {
            console.error("❌ 生成 witness 失敗:");
            console.error("請檢查 forge-ffi-scripts/generateWitnessFromServer.js 是否存在且可執行");
            console.error("或者檢查服務器是否正在運行在 localhost:3000");
        } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
            console.error("❌ Gas 估算失敗，可能是合約調用失敗");
            console.error("檢查 mixer 合約是否正確部署，參數是否有效");
        }
        throw error;
    }
}

main()
    .then((result) => {
        console.log("\n=== Withdraw Summary ===");
        console.log("- Transaction:", result.txHash);
        console.log("- Block:", result.blockNumber);
        console.log("- Amount received:", result.amountReceived, "Native");
        console.log("✅ 提款流程已完成！");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n=== Withdraw Failed ===");
        console.error(error.message);
        console.error(error);
        process.exit(1);
    });
