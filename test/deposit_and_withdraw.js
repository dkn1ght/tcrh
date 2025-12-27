// scripts/deposit.js
const { network, ethers } = require("hardhat");
const { load } = require("../lib/state");
const { execSync } = require("child_process");
const axios = require('axios');

async function main() {
    console.log("=== Starting Deposit Process ===");
    console.log("Network:", network.name);

    const [deployer] = await ethers.getSigners();

    // 檢查賬戶餘額
    const balance = await deployer.getBalance();
    console.log("User balance:", ethers.utils.formatEther(balance), "ETH");

    if (balance.lt(ethers.utils.parseEther("1.1"))) {
        throw new Error("餘額不足！需要至少 1.1 ETH (1 ETH 存款 + gas 費用)");
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

    // Declare variables that will be used in both deposit and withdraw sections
    let tx, receipt;

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

        const depositValue = ethers.utils.parseEther("1");
        console.log("Deposit amount:", ethers.utils.formatEther(depositValue), "ETH");

        // 估算 gas
        const gasEstimate = await mixer.connect(user).estimateGas.deposit(commitment, {
            value: depositValue
        });
        console.log("Estimated gas:", gasEstimate.toString());

        tx = await mixer.connect(user).deposit(commitment, {
            value: depositValue,
            gasLimit: gasEstimate.mul(120).div(100)
        });

        console.log("Transaction sent:", tx.hash);
        console.log("Waiting for confirmation...");

        receipt = await tx.wait();
        console.log("✅ Deposit confirmed!");
        console.log("Block number:", receipt.blockNumber);
        console.log("Gas used:", receipt.gasUsed.toString());

        // 3) 同步到服務器
        // console.log("\n=== Syncing to Server ===");
        // try {
        //     const serverResp = await axios.post('http://localhost:3000/api/leaves', {
        //         data: commitment
        //     });
        //     console.log("✅ Commitment 已同步到服務器");
        //     console.log("服務器索引:", serverResp.data.leaf.index);
        //     console.log("服務器根:", serverResp.data.rootHash);
        // } catch (serverError) {
        //     console.log("⚠️ 服務器同步失敗:", serverError.response?.data || serverError.message);
        //     console.log("可以稍後手動同步");
        // }

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

        // ============ WITHDRAW PROCESS STARTS HERE ============
        console.log("\n=== Starting Withdraw Process ===");

        console.log("Using note info:");
        console.log("- Nullifier:", noteInfo.nullifier);
        console.log("- Secret:", noteInfo.secret);
        console.log("- Commitment:", noteInfo.commitment);
        return;

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

        // 5) 從服務器獲取電路就緒的證明
        console.log("\n=== Getting Circuit Proof from Server ===");

        let circuitProof;
        try {
            const commitmentForServer = noteInfo.commitment.replace(/^0x/, ''); // Remove 0x prefix
            const proofResp = await axios.get(`http://localhost:3000/api/circuit-proof/${commitmentForServer}`);
            circuitProof = proofResp.data;

            console.log("✅ 在服務器中找到 commitment");
            console.log("服務器葉子索引:", circuitProof.leaf.index);
            console.log("路徑元素數量:", circuitProof.pathElements.length);
            console.log("路徑索引數量:", circuitProof.pathIndices.length);
            console.log("根哈希:", circuitProof.root.substring(0, 16) + "...");

        } catch (error) {
            if (error.response?.status === 404) {
                console.log("⚠️ 服務器中沒有找到 commitment，應該已經在步驟3同步過了");
                throw new Error("服務器中找不到 commitment，檢查同步是否成功");
            } else {
                throw new Error(`服務器錯誤: ${error.response?.data?.error || error.message}`);
            }
        }

        // 6) 使用新的簡化 witness 生成器
        console.log("\n=== Generating Witness Using Server Proof ===");

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
        console.log("執行命令預覽:", command.substring(0, 150) + "...");

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
        const serverRootWithPrefix = '0x' + circuitProof.root;
        const rootsMatch = root.toLowerCase() === serverRootWithPrefix.toLowerCase();
        console.log(`Proof 中的根: ${root}`);
        console.log(`服務器中的根: ${serverRootWithPrefix}`);
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

        console.log("Recipient balance before:", ethers.utils.formatEther(recipientBalanceBefore), "ETH");
        console.log("Mixer balance before:", ethers.utils.formatEther(mixerBalanceBefore), "ETH");

        // 11) 執行提款
        console.log("\n=== Executing Withdraw ===");

        tx = await mixer.withdraw(
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

        receipt = await tx.wait();
        console.log("✅ Withdraw confirmed!");
        console.log("Block number:", receipt.blockNumber);
        console.log("Gas used:", receipt.gasUsed.toString());

        // 12) 檢查提款後餘額
        console.log("\n=== Checking Final Balances ===");
        const recipientBalanceAfter = await ethers.provider.getBalance(recipient);
        const mixerBalanceAfter = await ethers.provider.getBalance(mixer.address);

        console.log("Recipient balance after:", ethers.utils.formatEther(recipientBalanceAfter), "ETH");
        console.log("Mixer balance after:", ethers.utils.formatEther(mixerBalanceAfter), "ETH");

        const received = recipientBalanceAfter.sub(recipientBalanceBefore);
        console.log("Amount received:", ethers.utils.formatEther(received), "ETH");

        console.log("\n=== Withdraw Completed Successfully ===");

        return {
            // Return both deposit and withdraw info
            deposit: {
                commitment: noteInfo.commitment,
                depositTxHash: noteInfo.txHash,
                depositBlockNumber: noteInfo.blockNumber
            },
            withdraw: {
                txHash: tx.hash,
                blockNumber: receipt.blockNumber,
                recipient: recipient,
                amountReceived: ethers.utils.formatEther(received),
                gasUsed: receipt.gasUsed.toString()
            }
        };

    } catch (error) {
        if (error.message.includes("generateCommitment.js")) {
            console.error("❌ 生成 commitment 失敗:");
            console.error("請檢查 forge-ffi-scripts/generateCommitment.js 是否存在且可執行");
        } else if (error.message.includes("generateWitnessFromServer.js")) {
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
        console.log("\n=== Final Summary ===");
        console.log("Deposit:");
        console.log("- Commitment:", result.deposit.commitment);
        console.log("- Transaction:", result.deposit.depositTxHash);
        console.log("- Block:", result.deposit.depositBlockNumber);
        console.log("Withdraw:");
        console.log("- Transaction:", result.withdraw.txHash);
        console.log("- Block:", result.withdraw.blockNumber);
        console.log("- Amount received:", result.withdraw.amountReceived, "ETH");
        console.log("✅ 完整的存款和提款流程已完成！");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n=== Process Failed ===");
        console.error(error.message);
        console.error(error);
        process.exit(1);
    });