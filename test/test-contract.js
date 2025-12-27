const { ethers } = require("hardhat");
const axios = require('axios');

// 手動定義合約 ABI
const HASHER_ABI = [
    "function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 k) external pure returns (uint256 xL, uint256 xR)"
];

const MERKLE_TREE_ABI = [
    "function levels() external view returns (uint32)",
    "function nextIndex() external view returns (uint32)", 
    "function getLastRoot() external view returns (bytes32)",
    "function zeros(uint256 i) external pure returns (bytes32)",
    "function insert(bytes32 _leaf) external returns (uint32)",
    "function isKnownRoot(bytes32 _root) external view returns (bool)",
    "function filledSubtrees(uint256) external view returns (bytes32)",
    "function roots(uint256) external view returns (bytes32)"
];

async function testContractVsServer() {
    console.log("開始測試合約與服務器根哈希一致性...\n");

    // 1. 連接到已部署的合約
    console.log("1. 連接到已部署的合約...");
    const hasherAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";  // 你的 hasher 地址
    
    // 你需要提供 MerkleTree 合約地址，假設是下一個地址
    const merkleTreeAddress = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0";  // 請替換為實際地址
    
    const [signer] = await ethers.getSigners();
    
    const hasher = new ethers.Contract(hasherAddress, HASHER_ABI, signer);
    const merkleTree = new ethers.Contract(merkleTreeAddress, MERKLE_TREE_ABI, signer);
    
    console.log(`Hasher 地址: ${hasherAddress}`);
    console.log(`MerkleTree 地址: ${merkleTreeAddress}\n`);

    // 2. 獲取初始根哈希
    console.log("2. 對比初始根哈希...");
    try {
        const contractRoot = await merkleTree.getLastRoot();
        const serverResp = await axios.get('http://localhost:3000/api/root');
        const serverRoot = '0x' + serverResp.data.rootHash;

        console.log(`合約初始根: ${contractRoot}`);
        console.log(`服務器根:   ${serverRoot}`);
        console.log(`初始根匹配: ${contractRoot.toLowerCase() === serverRoot.toLowerCase() ? '✅' : '❌'}\n`);

        if (contractRoot.toLowerCase() !== serverRoot.toLowerCase()) {
            console.error("初始根不匹配，停止測試");
            return;
        }
    } catch (error) {
        console.error("獲取初始根失敗:", error.message);
        return;
    }

    // 3. 對比零值
    console.log("3. 對比零值...");
    try {
        const zeroResp = await axios.get('http://localhost:3000/api/zero-values');
        const serverZeros = zeroResp.data.myCalculated;
        
        console.log("前5層零值對比:");
        for (let level = 0; level < 5; level++) {
            const contractZero = await merkleTree.zeros(level);
            const serverZero = serverZeros[level];
            const match = contractZero.toLowerCase() === serverZero.toLowerCase();
            console.log(`Level ${level}: ${match ? '✅' : '❌'}`);
            if (!match) {
                console.log(`  合約:   ${contractZero}`);
                console.log(`  服務器: ${serverZero}`);
            }
        }
        console.log("");
    } catch (error) {
        console.log("零值對比失敗:", error.message);
    }

    // 4. 測試添加相同的葉子
    console.log("4. 測試添加相同葉子...");
    const testLeaves = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
        "0x1111111111111111111111111111111111111111111111111111111111111111"
    ];

    for (let i = 0; i < testLeaves.length; i++) {
        const leaf = testLeaves[i];
        console.log(`\n測試葉子 ${i}: ${leaf.substring(0, 18)}...`);

        try {
            // 添加到合約
            console.log("添加到合約...");
            const tx = await merkleTree.insert(leaf);
            const receipt = await tx.wait();
            console.log(`Gas used: ${receipt.gasUsed}`);
            
            const newContractRoot = await merkleTree.getLastRoot();
            const contractIndex = await merkleTree.nextIndex();
            console.log(`合約新根: ${newContractRoot}`);
            console.log(`合約 nextIndex: ${contractIndex}`);

            // 添加到服務器
            console.log("添加到服務器...");
            const serverResp = await axios.post('http://localhost:3000/api/leaves', { data: leaf });
            const newServerRoot = '0x' + serverResp.data.rootHash;
            console.log(`服務器新根: ${newServerRoot}`);
            console.log(`服務器 index: ${serverResp.data.leaf.index}`);

            // 對比根哈希
            const rootsMatch = newContractRoot.toLowerCase() === newServerRoot.toLowerCase();
            console.log(`根哈希匹配: ${rootsMatch ? '✅' : '❌'}`);

            if (!rootsMatch) {
                console.error(`第 ${i} 個葉子後根哈希不匹配！`);
                console.error(`合約:   ${newContractRoot}`);
                console.error(`服務器: ${newServerRoot}`);
                
                // 顯示更多調試信息
                console.log("\n調試信息:");
                console.log(`合約 nextIndex: ${contractIndex}`);
                console.log(`服務器 index: ${serverResp.data.leaf.index}`);
                
                return;
            }
        } catch (error) {
            console.error(`測試葉子 ${i} 時出錯:`, error.message);
            if (error.response) {
                console.error("服務器錯誤:", error.response.data);
            }
            return;
        }
    }

    console.log(`\n🎉 所有 ${testLeaves.length} 個葉子的根哈希都匹配！`);
    
    // 5. 最終統計
    console.log("\n5. 最終統計...");
    try {
        const finalContractRoot = await merkleTree.getLastRoot();
        const finalContractIndex = await merkleTree.nextIndex();
        
        const serverStats = await axios.get('http://localhost:3000/api/stats');
        const finalServerRoot = '0x' + serverStats.data.rootHash;
        const finalServerCount = serverStats.data.leafCount;
        
        console.log(`最終根哈希匹配: ${finalContractRoot.toLowerCase() === finalServerRoot.toLowerCase() ? '✅' : '❌'}`);
        console.log(`葉子數量 - 合約: ${finalContractIndex}, 服務器: ${finalServerCount}`);
        
    } catch (error) {
        console.log("獲取最終統計失敗:", error.message);
    }
}

// 獨立測試函數：只測試特定葉子
async function quickTest(merkleTreeAddress, testLeaf) {
    console.log(`快速測試葉子: ${testLeaf}\n`);
    
    const [signer] = await ethers.getSigners();
    const merkleTree = new ethers.Contract(merkleTreeAddress, MERKLE_TREE_ABI, signer);
    
    try {
        // 合約
        const tx = await merkleTree.insert(testLeaf);
        await tx.wait();
        const contractRoot = await merkleTree.getLastRoot();
        
        // 服務器
        const serverResp = await axios.post('http://localhost:3000/api/leaves', { data: testLeaf });
        const serverRoot = '0x' + serverResp.data.rootHash;
        
        console.log(`合約根:   ${contractRoot}`);
        console.log(`服務器根: ${serverRoot}`);
        console.log(`匹配: ${contractRoot.toLowerCase() === serverRoot.toLowerCase() ? '✅' : '❌'}`);
        
    } catch (error) {
        console.error("快速測試失敗:", error.message);
    }
}

// 運行測試
if (require.main === module) {
    testContractVsServer()
        .then(() => {
            console.log("\n測試完成！");
            process.exit(0);
        })
        .catch((error) => {
            console.error("測試失敗:", error);
            process.exit(1);
        });
}

module.exports = {
    testContractVsServer,
    quickTest
};