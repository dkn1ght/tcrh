// test-server-vs-contract.js
const { ethers } = require("hardhat");
const axios = require('axios');

const MERKLE_TREE_ABI = [
    "function levels() external view returns (uint32)",
    "function nextIndex() external view returns (uint32)", 
    "function getLastRoot() external view returns (bytes32)",
    "function insert(bytes32 _leaf) external returns (uint32)"
];

async function testServerVsContract() {
    console.log("=== 服務器 vs 合約對比測試 ===\n");

    // 連接合約
    const { load } = require("../lib/state.js");
    const { network } = require("hardhat");
    
    const merkleAddress = await load(network.name)['merkle'];
    const [signer] = await ethers.getSigners();
    const merkle = new ethers.Contract(merkleAddress, MERKLE_TREE_ABI, signer);
    
    console.log(`合約地址: ${merkleAddress}\n`);

    try {
        // 1. 檢查初始狀態
        console.log("1. 檢查初始狀態");
        const contractRoot = await merkle.getLastRoot();
        const contractIndex = await merkle.nextIndex();
        
        const serverResp = await axios.get('http://localhost:3000/api/root');
        const serverRoot = '0x' + serverResp.data.rootHash;
        const serverIndex = serverResp.data.leafCount;
        
        console.log(`合約初始根: ${contractRoot}`);
        console.log(`服務器初始根: ${serverRoot}`);
        console.log(`初始根匹配: ${contractRoot.toLowerCase() === serverRoot.toLowerCase() ? '✅' : '❌'}`);
        console.log(`合約索引: ${contractIndex}, 服務器索引: ${serverIndex}\n`);

        // 2. 測試相同葉子插入
        const testLeaves = [
            "0x0000000000000000000000000000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000000000000000000000000000002"
        ];

        for (let i = 0; i < testLeaves.length; i++) {
            const leaf = testLeaves[i];
            console.log(`2.${i+1} 測試葉子: ${leaf}`);

            // 合約插入
            console.log("  合約插入...");
            const contractTx = await merkle.insert(leaf);
            await contractTx.wait();
            const newContractRoot = await merkle.getLastRoot();
            const newContractIndex = await merkle.nextIndex();

            // 服務器插入
            console.log("  服務器插入...");
            const serverResp = await axios.post('http://localhost:3000/api/leaves', { data: leaf });
            const newServerRoot = '0x' + serverResp.data.rootHash;
            const newServerIndex = serverResp.data.leaf.index + 1; // +1 因為是 nextIndex

            // 對比結果
            const rootsMatch = newContractRoot.toLowerCase() === newServerRoot.toLowerCase();
            const indexMatch = Number(newContractIndex) === newServerIndex;
            
            console.log(`  合約根: ${newContractRoot}`);
            console.log(`  服務器根: ${newServerRoot}`);
            console.log(`  根匹配: ${rootsMatch ? '✅' : '❌'}`);
            console.log(`  索引匹配: ${indexMatch ? '✅' : '❌'} (合約: ${newContractIndex}, 服務器: ${newServerIndex})\n`);

            if (!rootsMatch) {
                console.error(`❌ 第 ${i+1} 個葉子後根哈希不匹配！`);
                return;
            }
        }

        console.log("🎉 所有測試通過！服務器與合約完全匹配！");

    } catch (error) {
        console.error("❌ 測試失敗:", error.message);
        if (error.response) {
            console.error("服務器錯誤:", error.response.data);
        }
    }
}

// 運行測試
if (require.main === module) {
    testServerVsContract()
        .then(() => {
            console.log("\n測試完成！");
            process.exit(0);
        })
        .catch((error) => {
            console.error("測試失敗:", error);
            process.exit(1);
        });
}

module.exports = testServerVsContract;